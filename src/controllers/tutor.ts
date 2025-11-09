import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { generateUuid } from '../utils/keyGenerator';
import bcrypt from 'bcrypt';
import logger from '../config/logger';
import { createSSE as createSessionSSE } from './session';
import { Prisma } from '@prisma/client';
import fs from 'fs';

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
                        accountApiKey: generateUuid(),
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
                accountApiKey: generateUuid(),
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
            where: { device: { userId: pkId }, id: { contains: 'config' } },
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

export const listOutgoingMessagesAll: RequestHandler = async (req, res) => {
    try {
        const page = Number(req.query.page || 1);
        const pageSize = Number(req.query.pageSize || 25);
        const phoneNumber = (req.query.phoneNumber as string) || undefined;
        const message = (req.query.message as string) || undefined;
        const contactName = (req.query.contactName as string) || undefined;
        const onlyBroadcast = String(req.query.onlyBroadcast || '').toLowerCase();
        const isOnlyBroadcast =
            onlyBroadcast === '1' || onlyBroadcast === 'true' || onlyBroadcast === 'yes';
        const skip = (page - 1) * pageSize;

        // New: sorting support
        const sortByRaw = String(req.query.sortBy || 'createdAt');
        const sortDirRaw = String(req.query.sortDir || 'desc').toLowerCase();
        const allowedSorts = new Set(['createdAt', 'to', 'message', 'status']);
        const sortBy = allowedSorts.has(sortByRaw) ? sortByRaw : 'createdAt';
        const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';

        const where = {
            id: isOnlyBroadcast ? { startsWith: 'BC_' } : undefined,
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

        // Export branch: return CSV when export=csv
        const exportMode = String(req.query.export || '').toLowerCase() === 'csv';
        if (exportMode) {
            // Fetch up to 10000 rows for export to avoid memory issues
            const take = Math.min(Number(req.query.limit || 10000), 50000);
            const rows = await prisma.outgoingMessage.findMany({
                where: where as any,
                orderBy: { [sortBy]: sortDir } as any,
                take,
                include: { contact: { select: { firstName: true, lastName: true } } },
            });

            // Try to enrich tutor and source type minimally (best-effort)
            const data = [...rows] as any[];
            try {
                const sessionIds = Array.from(
                    new Set(rows.map((r) => r.sessionId).filter(Boolean) as string[]),
                );
                if (sessionIds.length) {
                    const sessions = await prisma.session.findMany({
                        where: { sessionId: { in: sessionIds } },
                        select: {
                            sessionId: true,
                            device: {
                                select: {
                                    user: {
                                        select: { firstName: true, lastName: true, email: true },
                                    },
                                    CustomerService: {
                                        select: {
                                            user: {
                                                select: {
                                                    firstName: true,
                                                    lastName: true,
                                                    email: true,
                                                },
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    });
                    const sidToTutor = new Map<
                        string,
                        {
                            firstName?: string | null;
                            lastName?: string | null;
                            email?: string | null;
                        }
                    >();
                    sessions.forEach((s) => {
                        const csUser = (s.device as any).CustomerService?.user;
                        const user = csUser || (s.device as any).user;
                        sidToTutor.set(s.sessionId, {
                            firstName: user?.firstName,
                            lastName: user?.lastName,
                            email: user?.email,
                        });
                    });
                    data.forEach((r) => {
                        const info = r.sessionId ? sidToTutor.get(r.sessionId) : undefined;
                        if (info) {
                            (r as any).tutor = {
                                firstName: info.firstName || info.email || 'Tutor',
                                lastName: info.lastName || '',
                            };
                        }
                    });
                }
            } catch {}

            // Prepare CSV
            const escapeCsv = (v: any) => {
                const s = v == null ? '' : String(v);
                if (/[",\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
                return s;
            };
            const headers = [
                'Waktu',
                'Nomor',
                'Kontak',
                'Pesan',
                // keep status in export for reference, though UI hides it
                'Status',
                'Tutor',
            ];
            const lines = [headers.join(',')];
            for (const r of data) {
                const waktu = r.createdAt ? new Date(r.createdAt).toISOString() : '';
                const nomor = String(r.to || '').replace('@s.whatsapp.net', '');
                const kontak = r.contact
                    ? [r.contact.firstName, r.contact.lastName].filter(Boolean).join(' ')
                    : '';
                const pesan = r.message || '';
                const status = r.status || '';
                const tutor = r.tutor
                    ? [r.tutor.firstName, r.tutor.lastName].filter(Boolean).join(' ')
                    : '';
                lines.push([waktu, nomor, kontak, pesan, status, tutor].map(escapeCsv).join(','));
            }

            res.setHeader('Content-Type', 'text/csv; charset=utf-8');
            res.setHeader('Content-Disposition', 'attachment; filename="sent-messages.csv"');
            res.status(200).send(lines.join('\n'));
            return;
        }

        const [rows, total] = await Promise.all([
            prisma.outgoingMessage.findMany({
                where: where as any,
                orderBy: { [sortBy]: sortDir } as any,
                skip,
                take: pageSize,
                include: { contact: { select: { firstName: true, lastName: true } } },
            }),
            prisma.outgoingMessage.count({ where: where as any }),
        ]);

        // Enrich with tutor info for broadcast messages via session -> device -> user
        const data = [...rows] as any[];
        try {
            const sessionIds = Array.from(
                new Set(rows.map((r) => r.sessionId).filter(Boolean) as string[]),
            );
            if (sessionIds.length) {
                const sessions = await prisma.session.findMany({
                    where: { sessionId: { in: sessionIds } },
                    select: {
                        sessionId: true,
                        device: {
                            select: {
                                id: true,
                                user: { select: { firstName: true, lastName: true, email: true } },
                                CustomerService: {
                                    select: {
                                        user: {
                                            select: {
                                                firstName: true,
                                                lastName: true,
                                                email: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                });
                const sidToTutor = new Map<
                    string,
                    { firstName?: string | null; lastName?: string | null; email?: string | null }
                >();
                sessions.forEach((s) => {
                    const csUser = (s.device as any).CustomerService?.user;
                    const user = csUser || s.device.user;
                    sidToTutor.set(s.sessionId, {
                        firstName: user?.firstName,
                        lastName: user?.lastName,
                        email: user?.email,
                    });
                });
                data.forEach((r) => {
                    const info = r.sessionId ? sidToTutor.get(r.sessionId) : undefined;
                    if (info) {
                        (r as any).tutor = {
                            firstName: info.firstName || info.email || 'Tutor',
                            lastName: info.lastName || '',
                        };
                    }
                });
            }
            // Fallback: map via Broadcast pkId parsed from OutgoingMessage.id (BC_<pkId>_...)
            const bcIds = Array.from(
                new Set(
                    rows
                        .map((r) =>
                            typeof r.id === 'string' && r.id.startsWith('BC_')
                                ? Number(String(r.id).slice(3).split('_')[0])
                                : null,
                        )
                        .filter((v): v is number => !!v && Number.isFinite(v)),
                ),
            );
            if (bcIds.length) {
                const broadcasts = await prisma.broadcast.findMany({
                    where: { pkId: { in: bcIds } },
                    select: {
                        pkId: true,
                        name: true,
                        device: {
                            select: {
                                user: { select: { firstName: true, lastName: true, email: true } },
                                CustomerService: {
                                    select: {
                                        user: {
                                            select: {
                                                firstName: true,
                                                lastName: true,
                                                email: true,
                                            },
                                        },
                                    },
                                },
                            },
                        },
                    },
                });
                // Prepare feedback courseName detection for current broadcast names
                const names = Array.from(new Set(broadcasts.map((b) => b.name).filter(Boolean)));
                let feedbackNames = new Set<string>();
                if (names.length) {
                    try {
                        // Extract courseName from broadcast names that have format "feedbackName - courseName"
                        const courseNames = names
                            .map((name) => {
                                const match = name.match(/^.+\s*-\s*(.+)$/);
                                return match ? match[1].trim() : null;
                            })
                            .filter((courseName): courseName is string => courseName !== null);

                        if (courseNames.length > 0) {
                            const fbs = await prisma.courseFeedback.findMany({
                                where: { courseName: { in: courseNames } },
                                select: { courseName: true },
                            });
                            feedbackNames = new Set(fbs.map((x) => x.courseName));
                        }
                    } catch (_) {
                        /* ignore */
                    }
                }

                const bcMeta = new Map<
                    number,
                    {
                        name?: string | null;
                        tutor?: {
                            firstName?: string | null;
                            lastName?: string | null;
                            email?: string | null;
                        } | null;
                        type?: 'feedback' | 'reminder' | 'broadcast';
                    }
                >();
                broadcasts.forEach((b) => {
                    const csUser = (b.device as any).CustomerService?.user;
                    const user = csUser || b.device.user;
                    const name = b.name || '';
                    const isReminder = /\b(Recipients|Reminder)\b/i.test(name);
                    let type: 'feedback' | 'reminder' | 'broadcast' = 'broadcast';

                    if (isReminder) {
                        type = 'reminder';
                    } else {
                        // Check if this broadcast name contains a courseName that exists in CourseFeedback
                        const courseMatch = name.match(/^.+\s*-\s*(.+)$/);
                        if (courseMatch && feedbackNames.has(courseMatch[1].trim())) {
                            type = 'feedback';
                        }
                    }

                    bcMeta.set(b.pkId, {
                        name,
                        tutor: {
                            firstName: user?.firstName,
                            lastName: user?.lastName,
                            email: user?.email,
                        },
                        type,
                    });
                });
                data.forEach((r) => {
                    if (typeof r.id === 'string' && r.id.startsWith('BC_')) {
                        const pk = Number(String(r.id).slice(3).split('_')[0]);
                        const meta = bcMeta.get(pk);
                        if (meta) {
                            if (!(r as any).tutor && meta.tutor) {
                                (r as any).tutor = {
                                    firstName: meta.tutor.firstName || meta.tutor.email || 'Tutor',
                                    lastName: meta.tutor.lastName || '',
                                };
                            }
                            (r as any).broadcastName = meta.name || undefined;
                            (r as any).broadcastType = meta.type || undefined;
                        }
                    }
                });
            }
        } catch (e) {
            // ignore enrichment errors; return base rows
        }

        res.status(200).json({
            data,
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

export const deleteOutgoingMessagesAll: RequestHandler = async (req, res) => {
    try {
        const phoneNumber = (req.query.phoneNumber as string) || undefined;
        const onlyBroadcast = String(req.query.onlyBroadcast || '').toLowerCase();
        const isOnlyBroadcast =
            onlyBroadcast === '1' || onlyBroadcast === 'true' || onlyBroadcast === 'yes';
        const statusesRaw = (req.query.status as string) || '';
        const olderThanMinutes = Math.max(0, Number(req.query.olderThanMinutes || 10));
        const threshold = olderThanMinutes
            ? new Date(Date.now() - olderThanMinutes * 60 * 1000)
            : undefined;

        // Defaults: delete acked/delivered/read/played. Also delete stale 'pending' older than threshold.
        const defaultAckStatuses = ['server_ack', 'delivery_ack', 'read', 'played'];

        let where: any = {
            id: isOnlyBroadcast ? { startsWith: 'BC_' } : undefined,
            to: phoneNumber ? { contains: phoneNumber } : undefined,
        };

        if (!statusesRaw) {
            where.OR = [
                { status: { in: defaultAckStatuses } },
                ...(threshold ? [{ status: 'pending', createdAt: { lt: threshold } }] : []),
            ];
        } else if (statusesRaw.toLowerCase() === 'all') {
            // no status filter
        } else {
            const list = statusesRaw
                .split(',')
                .map((s) => s.trim())
                .filter(Boolean);
            if (list.length) where.status = { in: list };
        }

        // Collect media paths first (avoid losing the info after deletion)
        const mediaMessages = await prisma.outgoingMessage.findMany({
            where,
            select: { mediaPath: true },
        });
        const mediaPaths = Array.from(
            new Set(
                mediaMessages
                    .map((m) => m.mediaPath)
                    .filter((p): p is string => !!p && typeof p === 'string'),
            ),
        );

        // Delete DB rows
        const result = await prisma.outgoingMessage.deleteMany({ where });

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
            data: { name, apiKey: generateUuid(), user: { connect: { pkId } } },
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
