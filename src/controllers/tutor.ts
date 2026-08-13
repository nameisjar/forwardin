import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { generateUuid } from '../utils/keyGenerator';
import { hashApiKey } from '../utils/apiKeyHash';
import bcrypt from 'bcrypt';
import logger from '../config/logger';
import { createSSE as createSessionSSE } from './session';
import { Prisma } from '@prisma/client';
import fs from 'fs';
import { accessibleDeviceWhere } from '../utils/deviceAccess';
import { decryptOutgoingMessage } from '../utils/messageEncryption';

const ADMIN_ID = Number(process.env.ADMIN_ID);
const SUPER_ADMIN_ID = Number(process.env.SUPER_ADMIN_ID);
const CS_ID = Number(process.env.CS_ID);

async function getCsPrivilegePkId(): Promise<number | undefined> {
    if (!isNaN(CS_ID)) return CS_ID;
    try {
        const role = await prisma.privilege.findFirst({
            where: { name: 'cs' },
            select: { pkId: true },
        });
        return role?.pkId || undefined;
    } catch {
        return undefined;
    }
}

export const getMe: RequestHandler = async (req, res) => {
    try {
        const me = await prisma.user.findUnique({
            where: { id: req.authenticatedUser.id },
            select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
                privilege: { select: { name: true, pkId: true } },
                affiliationCode: true,
            },
        });
        res.status(200).json(me);
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createTutor: RequestHandler = async (req, res) => {
    try {
        const { firstName, email, password } = req.body as {
            firstName: string;
            email: string;
            password?: string;
        };
        if (!firstName || !email)
            return res.status(400).json({ message: 'firstName and email are required' });

        // Check if user with email exists (including soft-deleted)
        const existingAny = await prisma.user.findUnique({ where: { email } });
        const rawPassword = password || Math.random().toString(36).slice(2, 10);
        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        const csPkId = await getCsPrivilegePkId();

        if (existingAny) {
            // If soft-deleted, restore and update as tutor
            if (existingAny.deletedAt) {
                const restored = await prisma.user.update({
                    where: { pkId: existingAny.pkId },
                    data: {
                        firstName,
                        // keep lastName as-is
                        password: hashedPassword,
                        accountApiKey: hashApiKey(generateUuid()),
                        emailVerifiedAt: new Date(),
                        privilegeId: csPkId,
                        deletedAt: null,
                        updatedAt: new Date(),
                    },
                    select: { id: true, email: true, firstName: true },
                });
                return res.status(201).json({ message: 'Tutor restored', user: restored });
            }
            // Active user with same email still exists
            return res.status(409).json({ message: 'Email already exists' });
        }

        // Create new tutor if not exists at all
        const user = await prisma.user.create({
            data: {
                firstName,
                email,
                password: hashedPassword,
                accountApiKey: hashApiKey(generateUuid()),
                emailVerifiedAt: new Date(),
                privilegeId: csPkId,
            },
            select: { id: true, email: true, firstName: true },
        });

        res.status(201).json({ message: 'Tutor created', user });
    } catch (e: any) {
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return res.status(409).json({ message: 'Email already exists' });
        }
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const listTutors: RequestHandler = async (req, res) => {
    try {
        const csPkId = await getCsPrivilegePkId();
        const baseOrConds: any[] = [{ affiliationCode: 'tutor' }];
        if (csPkId) baseOrConds.push({ privilegeId: csPkId });

        const search = (req.query.search as string | undefined)?.trim();
        const page = Math.max(1, Number(req.query.page || 1));
        const pageSizeRaw = Number(req.query.pageSize || 0);
        const pageSize = pageSizeRaw > 0 ? Math.min(100, pageSizeRaw) : 0; // 0 means no pagination
        const sortByRaw = String(req.query.sortBy || '').trim();
        const sortDirRaw = String(req.query.sortDir || '').toLowerCase();
        const allowedSorts = new Set(['createdAt', 'firstName', 'lastName', 'email']);
        const sortBy = allowedSorts.has(sortByRaw) ? sortByRaw : '';
        const sortDir: 'asc' | 'desc' = sortDirRaw === 'asc' ? 'asc' : 'desc';

        const where: any = {
            deletedAt: null,
            OR: baseOrConds,
        };
        if (search) {
            where.AND = [
                {
                    OR: [
                        { firstName: { contains: search, mode: 'insensitive' as const } },
                        { lastName: { contains: search, mode: 'insensitive' as const } },
                        { email: { contains: search, mode: 'insensitive' as const } },
                    ],
                },
            ];
        }

        const hasPagingOrSort =
            !!search || !!sortBy || !!req.query.page || !!req.query.pageSize || !!req.query.sortDir;

        // Build orderBy
        const orderBy: any[] = [];
        if (sortBy) {
            orderBy.push({ [sortBy]: sortDir } as any);
        }
        // Always add createdAt desc as secondary for stable results
        orderBy.push({ createdAt: 'desc' });

        if (hasPagingOrSort) {
            const skip = pageSize > 0 ? (page - 1) * pageSize : 0;
            const [rows, total] = await Promise.all([
                prisma.user.findMany({
                    where,
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        createdAt: true,
                        devices: { select: { id: true, name: true, status: true } },
                    },
                    orderBy: orderBy as any,
                    skip: pageSize > 0 ? skip : undefined,
                    take: pageSize > 0 ? pageSize : undefined,
                }),
                prisma.user.count({ where }),
            ]);

            return res.status(200).json({
                data: rows,
                metadata: {
                    total: total,
                    currentPage: page,
                    pageSize: pageSize > 0 ? pageSize : total,
                    totalPages: pageSize > 0 ? Math.ceil(total / pageSize) : 1,
                    hasMore: pageSize > 0 ? skip + rows.length < total : false,
                    sortBy: sortBy || 'createdAt',
                    sortDir,
                    search: search || '',
                },
            });
        }

        // Backward-compatible behavior: no paging/sort/search => return plain array
        const users = await prisma.user.findMany({
            where,
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                createdAt: true,
                devices: { select: { id: true, name: true, status: true } },
            },
            orderBy: { createdAt: 'desc' },
        });
        res.status(200).json(users);
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const listOutgoingMessages: RequestHandler = async (req, res) => {
    try {
        const pkId = req.authenticatedUser.pkId;
        const sessions = await prisma.session.findMany({
            where: {
                device: accessibleDeviceWhere(pkId, req.privilege?.pkId),
                id: { contains: 'config' },
            },
            select: { sessionId: true },
        });
        const sessionIds = sessions.map((s) => s.sessionId);
        const page = Number(req.query.page || 1);
        const pageSize = Number(req.query.pageSize || 25);
        const phoneNumber = (req.query.phoneNumber as string) || undefined;
        const message = (req.query.message as string) || undefined;
        const contactName = (req.query.contactName as string) || undefined;
        const skip = (page - 1) * pageSize;
        const where = {
            sessionId: { in: sessionIds },
            to: phoneNumber ? { contains: phoneNumber } : undefined,
            message: message ? { contains: message, mode: 'insensitive' as const } : undefined,
            contact: contactName
                ? {
                      OR: [
                          { firstName: { contains: contactName, mode: 'insensitive' as const } },
                          { lastName: { contains: contactName, mode: 'insensitive' as const } },
                      ],
                  }
                : undefined,
        } as const;
        const [rows, total] = await Promise.all([
            prisma.outgoingMessage.findMany({
                where: where as any,
                orderBy: { createdAt: 'desc' },
                skip,
                take: pageSize,
                include: { contact: { select: { firstName: true, lastName: true } } },
            }),
            prisma.outgoingMessage.count({ where: where as any }),
        ]);
        res.status(200).json({
            data: rows,
            metadata: {
                totalMessages: total,
                currentPage: page,
                totalPages: Math.ceil(total / pageSize),
                hasMore: skip + rows.length < total,
            },
        });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};


type SentHistorySource = 'inbox' | 'broadcast' | 'reminder' | 'feedback' | 'recurrence';

type SentHistoryFilters = {
    phoneNumber?: string;
    message?: string;
    contactName?: string;
    tutorName?: string;
    source?: string;
    status?: string;
    onlyBroadcast?: boolean;
    sortBy?: string;
    sortDir?: 'asc' | 'desc';
};

export const normalizeHistoryPhone = (value: unknown): string =>
    String(value || '')
        .replace(/@(s\.whatsapp\.net|lid|g\.us)$/i, '')
        .replace(/\D/g, '');

export const isHistoryGroup = (row: any): boolean =>
    row?.isGroup === true || String(row?.to || '').toLowerCase().endsWith('@g.us');

const historyContactName = (row: any): string =>
    row?.contact
        ? [row.contact.firstName, row.contact.lastName].filter(Boolean).join(' ').trim()
        : '';

const historyTutorName = (row: any): string =>
    row?.tutor
        ? [row.tutor.firstName, row.tutor.lastName].filter(Boolean).join(' ').trim()
        : '';

const normalizeHistorySource = (value: unknown): SentHistorySource | null => {
    const source = String(value || '').trim().toLowerCase();
    return ['inbox', 'broadcast', 'reminder', 'feedback', 'recurrence'].includes(source)
        ? (source as SentHistorySource)
        : null;
};

const inferBroadcastHistorySource = (
    broadcast: any,
    feedbackCourseNames: Set<string> = new Set(),
): SentHistorySource => {
    const explicit = normalizeHistorySource(broadcast?.broadcastType);
    if (explicit) return explicit;

    const name = String(broadcast?.name || '').toLowerCase();
    if (/\[(berulang|recurrence|recurring)\]/i.test(name)) return 'recurrence';
    if (/\[reminder\]|\brecipients\b/i.test(name)) return 'reminder';
    if (name.includes('[feedback]')) return 'feedback';
    const courseMatch = name.match(/^.+\s*-\s*(.+)$/);
    if (courseMatch && feedbackCourseNames.has(courseMatch[1].trim())) return 'feedback';
    return 'broadcast';
};

export const inferHistorySource = (row: any): SentHistorySource => {
    const explicit = normalizeHistorySource(row?.sourceType || row?.broadcastType);
    if (explicit) return explicit;
    if (row?.broadcastId != null || String(row?.id || '').startsWith('BC_')) return 'broadcast';
    return 'inbox';
};

export const historyStatusCounts = (rows: any[]) => {
    const result = { total: rows.length, delivered: 0, failed: 0, processing: 0 };
    rows.forEach((row) => {
        const status = String(row?.status || '').toLowerCase();
        if (status.includes('fail') || status.includes('error')) result.failed += 1;
        else if (['delivery_ack', 'read', 'played'].includes(status)) result.delivered += 1;
        else result.processing += 1;
    });
    return result;
};

const historyUserFromDevice = (device: any): any =>
    device?.CustomerService?.user || device?.user || null;

const historyTutorFromUser = (user: any): any =>
    user
        ? {
              firstName: user.firstName || user.email || 'Tutor',
              lastName: user.lastName || '',
          }
        : null;

async function buildSentHistoryRows(filters: SentHistoryFilters): Promise<any[]> {
    const rows = (await prisma.outgoingMessage.findMany({
        where: {
            id: filters.onlyBroadcast ? { startsWith: 'BC_' } : undefined,
            to: filters.phoneNumber ? { contains: normalizeHistoryPhone(filters.phoneNumber) } : undefined,
        } as any,
        include: {
            contact: { select: { pkId: true, firstName: true, lastName: true, phone: true } },
            device: {
                select: {
                    pkId: true,
                    id: true,
                    name: true,
                    user: { select: { firstName: true, lastName: true, email: true } },
                    CustomerService: {
                        select: {
                            user: { select: { firstName: true, lastName: true, email: true } },
                        },
                    },
                },
            },
        },
    })) as any[];

    const data = rows.map((row) => {
        try {
            return decryptOutgoingMessage(row);
        } catch {
            return { ...row, message: '[Pesan tidak dapat didekripsi]', messageDecryptionFailed: true };
        }
    });

    const sessionIds = Array.from(
        new Set(data.map((row) => row.sessionId).filter(Boolean) as string[]),
    );
    const sessionMap = new Map<string, any>();
    if (sessionIds.length) {
        const sessions = await prisma.session.findMany({
            where: { sessionId: { in: sessionIds } },
            select: {
                sessionId: true,
                device: {
                    select: {
                        pkId: true,
                        id: true,
                        name: true,
                        user: { select: { firstName: true, lastName: true, email: true } },
                        CustomerService: {
                            select: {
                                user: { select: { firstName: true, lastName: true, email: true } },
                            },
                        },
                    },
                },
            },
        });
        sessions.forEach((session) => sessionMap.set(session.sessionId, session.device));
    }

    data.forEach((row) => {
        const device = row.device || (row.sessionId ? sessionMap.get(row.sessionId) : null);
        if (!row.device && device) row.device = device;
        if (!row.deviceId && device?.pkId) row.deviceId = device.pkId;
        row.tutor = historyTutorFromUser(historyUserFromDevice(device));
    });

    const broadcastIds = Array.from(
        new Set(
            data
                .map((row) => {
                    if (row.broadcastId != null && Number.isFinite(Number(row.broadcastId))) {
                        return Number(row.broadcastId);
                    }
                    const match = String(row.id || '').match(/^BC_(\d+)_/);
                    return match ? Number(match[1]) : null;
                })
                .filter((value): value is number => value != null && Number.isFinite(value)),
        ),
    );
    if (broadcastIds.length) {
        const broadcasts = await prisma.broadcast.findMany({
            where: { pkId: { in: broadcastIds } },
            select: {
                pkId: true,
                name: true,
                broadcastType: true,
                device: {
                    select: {
                        name: true,
                        user: { select: { firstName: true, lastName: true, email: true } },
                        CustomerService: {
                            select: {
                                user: { select: { firstName: true, lastName: true, email: true } },
                            },
                        },
                    },
                },
            },
        });
        const feedbackCourseCandidates = broadcasts
            .map((broadcast) => String(broadcast.name || '').match(/^.+\s*-\s*(.+)$/)?.[1]?.trim())
            .filter((name): name is string => Boolean(name));
        const feedbackCourses = feedbackCourseCandidates.length
            ? await prisma.courseFeedback.findMany({
                  where: { courseName: { in: feedbackCourseCandidates } },
                  select: { courseName: true },
              })
            : [];
        const feedbackCourseNames = new Set(feedbackCourses.map((item) => item.courseName));
        const broadcastMap = new Map(broadcasts.map((broadcast) => [broadcast.pkId, broadcast]));
        data.forEach((row) => {
            const match = String(row.id || '').match(/^BC_(\d+)_/);
            const broadcastId = Number(row.broadcastId || (match ? match[1] : 0));
            const broadcast = broadcastMap.get(broadcastId);
            if (!broadcast) return;
            row.broadcastName = broadcast.name || undefined;
            row.broadcastType = inferBroadcastHistorySource(broadcast, feedbackCourseNames);
            if (!row.tutor) {
                row.tutor = historyTutorFromUser(historyUserFromDevice(broadcast.device));
            }
        });
    }

    const deviceIds = Array.from(
        new Set(data.map((row) => Number(row.deviceId)).filter((id) => Number.isFinite(id) && id > 0)),
    );
    if (deviceIds.length) {
        const contacts = await prisma.contact.findMany({
            where: { contactDevices: { some: { deviceId: { in: deviceIds } } } },
            select: {
                pkId: true,
                firstName: true,
                lastName: true,
                phone: true,
                contactDevices: {
                    where: { deviceId: { in: deviceIds } },
                    select: { deviceId: true },
                },
            },
        });
        const contactMap = new Map<string, any>();
        contacts.forEach((contact) => {
            contact.contactDevices.forEach((link) => {
                contactMap.set(`${link.deviceId}:${normalizeHistoryPhone(contact.phone)}`, contact);
            });
        });
        data.forEach((row) => {
            if (row.contact || isHistoryGroup(row) || !row.deviceId) return;
            row.contact =
                contactMap.get(`${row.deviceId}:${normalizeHistoryPhone(row.to)}`) || null;
        });
    }

    data.forEach((row) => {
        row.sourceType = inferHistorySource(row);
    });

    const messageQuery = String(filters.message || '').trim().toLowerCase();
    const contactQuery = String(filters.contactName || '').trim().toLowerCase();
    const tutorQuery = String(filters.tutorName || '').trim().toLowerCase();
    const sourceQuery = String(filters.source || '').trim().toLowerCase();
    const statusQuery = String(filters.status || '').trim().toLowerCase();
    const filtered = data.filter((row) => {
        if (messageQuery && !String(row.message || '').toLowerCase().includes(messageQuery)) return false;
        if (contactQuery && !historyContactName(row).toLowerCase().includes(contactQuery)) return false;
        if (tutorQuery && !historyTutorName(row).toLowerCase().includes(tutorQuery)) return false;
        if (sourceQuery && row.sourceType !== sourceQuery) return false;
        if (statusQuery && String(row.status || '').toLowerCase() !== statusQuery) return false;
        return true;
    });

    const sortBy = ['createdAt', 'to', 'message', 'status'].includes(String(filters.sortBy))
        ? String(filters.sortBy)
        : 'createdAt';
    const direction = filters.sortDir === 'asc' ? 1 : -1;
    filtered.sort((left, right) => {
        if (sortBy === 'createdAt') {
            return (new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime()) * direction;
        }
        return (
            String(left[sortBy] || '').localeCompare(String(right[sortBy] || ''), 'id', {
                sensitivity: 'base',
                numeric: true,
            }) * direction
        );
    });
    return filtered;
}

export const listOutgoingMessagesAll: RequestHandler = async (req, res) => {
    try {
        const page = Math.max(1, Number(req.query.page || 1));
        const pageSize = Math.min(100, Math.max(10, Number(req.query.pageSize || 25)));
        const onlyBroadcast = ['1', 'true', 'yes'].includes(
            String(req.query.onlyBroadcast || '').toLowerCase(),
        );
        const filters: SentHistoryFilters = {
            phoneNumber: (req.query.phoneNumber as string) || undefined,
            message: (req.query.message as string) || undefined,
            contactName: (req.query.contactName as string) || undefined,
            tutorName: (req.query.tutorName as string) || undefined,
            source: (req.query.source as string) || undefined,
            status: (req.query.status as string) || undefined,
            onlyBroadcast,
            sortBy: String(req.query.sortBy || 'createdAt'),
            sortDir: String(req.query.sortDir || '').toLowerCase() === 'asc' ? 'asc' : 'desc',
        };
        const allRows = await buildSentHistoryRows(filters);

        if (String(req.query.export || '').toLowerCase() === 'csv') {
            const take = Math.min(Math.max(1, Number(req.query.limit || 10000)), 50000);
            const escapeCsv = (value: any) => {
                const text = value == null ? '' : String(value);
                return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
            };
            const headers = [
                'Waktu',
                'Nomor',
                'Kontak',
                'Pesan',
                'Status',
                'Sumber',
                'Tutor',
                'Perangkat',
            ];
            const lines = [headers.join(',')];
            allRows.slice(0, take).forEach((row) => {
                lines.push(
                    [
                        row.createdAt ? new Date(row.createdAt).toISOString() : '',
                        normalizeHistoryPhone(row.to),
                        historyContactName(row),
                        row.message || '',
                        row.status || '',
                        row.sourceType || '',
                        historyTutorName(row),
                        row.device?.name || '',
                    ]
                        .map(escapeCsv)
                        .join(','),
                );
            });
            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="sent-messages.csv"');
            res.status(200).send('\uFEFF' + lines.join('\n'));
            return;
        }

        const skip = (page - 1) * pageSize;
        const data = allRows.slice(skip, skip + pageSize);
        const total = allRows.length;
        res.status(200).json({
            data,
            metadata: {
                totalMessages: total,
                currentPage: page,
                totalPages: Math.max(1, Math.ceil(total / pageSize)),
                hasMore: skip + data.length < total,
                statusCounts: historyStatusCounts(allRows),
            },
        });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteOutgoingMessagesAll: RequestHandler = async (req, res) => {
    try {
        const filters: SentHistoryFilters = {
            phoneNumber: (req.query.phoneNumber as string) || undefined,
            message: (req.query.message as string) || undefined,
            contactName: (req.query.contactName as string) || undefined,
            tutorName: (req.query.tutorName as string) || undefined,
            source: (req.query.source as string) || undefined,
            status:
                String(req.query.status || '').toLowerCase() === 'all'
                    ? undefined
                    : (req.query.status as string) || undefined,
            onlyBroadcast: ['1', 'true', 'yes'].includes(
                String(req.query.onlyBroadcast || '').toLowerCase(),
            ),
        };
        const matchedRows = await buildSentHistoryRows(filters);
        const pkIds = matchedRows.map((row) => Number(row.pkId)).filter(Number.isFinite);
        if (!pkIds.length) {
            res.status(200).json({ message: 'No sent messages matched', deletedCount: 0, mediaDeleted: 0 });
            return;
        }

        const mediaPaths = Array.from(
            new Set(
                matchedRows
                    .map((row) => row.mediaPath)
                    .filter((p): p is string => !!p && typeof p === 'string'),
            ),
        );

        const result = await prisma.outgoingMessage.deleteMany({
            where: { pkId: { in: pkIds } },
        });

        // Attempt to unlink files (ignore errors, continue)
        for (const p of mediaPaths) {
            try {
                fs.unlinkSync(p);
            } catch {}
        }

        res.status(200).json({
            message: 'Deleted sent messages',
            deletedCount: result.count,
            mediaDeleted: mediaPaths.length,
        });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createDeviceNoSubscription: RequestHandler = async (req, res) => {
    try {
        const { name } = req.body as { name: string };
        if (!name) return res.status(400).json({ message: 'name is required' });
        const pkId = req.authenticatedUser.pkId;
        const roleId = req.privilege?.pkId;

        // If tutor/CS, enforce max 1 device
        if (roleId === CS_ID) {
            const existingCount = await prisma.device.count({ where: { userId: pkId } });
            if (existingCount >= 1) {
                return res.status(400).json({ message: 'Tutor hanya dapat memiliki 1 device' });
            }
        }

        const device = await prisma.device.create({
            data: { name, apiKey: hashApiKey(generateUuid()), user: { connect: { pkId } } },
        });
        res.status(201).json({ message: 'Device created', data: device });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const listGroups: RequestHandler = async (req, res) => {
    try {
        const pkId = req.authenticatedUser.pkId;
        const groups = await prisma.group.findMany({
            where: { userId: pkId },
            select: { id: true, name: true },
        });
        res.status(200).json(groups);
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// re-export for route usage
export const createSSE: RequestHandler = (req, res, next) => createSessionSSE(req, res, next);

/**
 * Get message statistics (sent + scheduled) for a specific device
 */
export const getDeviceMessageStats: RequestHandler = async (req, res) => {
    try {
        const deviceId = Number(req.params.deviceId);
        if (!deviceId || isNaN(deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        // Check if device exists and user has access
        const device = await prisma.device.findFirst({
            where: {
                pkId: deviceId,
                ...accessibleDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            include: { sessions: { select: { sessionId: true } } },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // Get session IDs for this device
        const sessionIds = device.sessions.map((s) => s.sessionId);

        // Count sent messages (outgoing messages)
        const sentCount = sessionIds.length > 0
            ? await prisma.outgoingMessage.count({
                where: { sessionId: { in: sessionIds } },
            })
            : 0;

        // Count scheduled broadcasts (pending broadcasts for this device)
        const scheduledCount = await prisma.broadcast.count({
            where: {
                deviceId: deviceId,
                schedule: { gt: new Date() }, // Future schedules only
            },
        });

        res.status(200).json({
            deviceId,
            sent: sentCount,
            scheduled: scheduledCount,
            total: sentCount + scheduledCount,
        });
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Get message statistics for all devices (batch)
 * Returns stats keyed by device.id (UUID) for frontend compatibility
 * 
 * Note: OutgoingMessage.sessionId may be NULL when device is disconnected.
 * We count sent messages via Broadcast -> OutgoingMessage relationship,
 * since Broadcast.deviceId is always preserved.
 */
export const getAllDevicesMessageStats: RequestHandler = async (req, res) => {
    try {
        const pkId = req.authenticatedUser.pkId;
        const roleId = req.privilege?.pkId;

        // Get devices based on role
        let devices;
        if (roleId === ADMIN_ID || roleId === SUPER_ADMIN_ID) {
            // Admin can see all devices
            devices = await prisma.device.findMany({
                select: {
                    id: true,
                    pkId: true,
                },
            });
        } else {
            // Tutor/CS can only see their own devices
            devices = await prisma.device.findMany({
                where: accessibleDeviceWhere(pkId, roleId),
                select: {
                    id: true,
                    pkId: true,
                },
            });
        }

        if (devices.length === 0) {
            return res.status(200).json({});
        }

        const devicePkIds = devices.map(d => d.pkId);
        const now = new Date();

        // 🔥 BATCH QUERY 1: Get all broadcasts for all devices in ONE query
        const allBroadcasts = await prisma.broadcast.findMany({
            where: { deviceId: { in: devicePkIds } },
            select: { pkId: true, deviceId: true, schedule: true },
        });

        // Group broadcasts by deviceId
        const broadcastsByDevice = new Map<number, { pkId: number; schedule: Date | null }[]>();
        for (const b of allBroadcasts) {
            if (!broadcastsByDevice.has(b.deviceId)) {
                broadcastsByDevice.set(b.deviceId, []);
            }
            broadcastsByDevice.get(b.deviceId)!.push({ pkId: b.pkId, schedule: b.schedule });
        }

        // 🔥 BATCH QUERY 2: Count sent messages per broadcast in ONE query using groupBy
        const allBroadcastIds = allBroadcasts.map(b => b.pkId);
        let sentCountsByBroadcast = new Map<number, number>();
        
        if (allBroadcastIds.length > 0) {
            const sentCounts = await prisma.outgoingMessage.groupBy({
                by: ['broadcastId'],
                where: { broadcastId: { in: allBroadcastIds } },
                _count: { _all: true },
            });
            
            for (const sc of sentCounts) {
                if (sc.broadcastId !== null) {
                    sentCountsByBroadcast.set(sc.broadcastId, sc._count._all);
                }
            }
        }

        // Build stats using pre-fetched data (no more N+1!)
        const stats: Record<string, { sent: number; scheduled: number; total: number }> = {};

        for (const device of devices) {
            const deviceBroadcasts = broadcastsByDevice.get(device.pkId) || [];
            
            // Sum sent count from all broadcasts for this device
            let sentCount = 0;
            for (const b of deviceBroadcasts) {
                sentCount += sentCountsByBroadcast.get(b.pkId) || 0;
            }

            // Count scheduled broadcasts (future schedules only)
            const scheduledCount = deviceBroadcasts.filter(
                b => b.schedule && new Date(b.schedule) > now
            ).length;

            // Use device.id (UUID) as key
            stats[device.id] = {
                sent: sentCount,
                scheduled: scheduledCount,
                total: sentCount + scheduledCount,
            };
        }

        res.status(200).json(stats);
    } catch (e) {
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};
