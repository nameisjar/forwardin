import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { generateUuid } from '../utils/keyGenerator';
import bcrypt from 'bcrypt';
import logger from '../config/logger';
import { createSSE as createSessionSSE } from './session';
import { Prisma } from '@prisma/client';

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

        const existing = await prisma.user.findUnique({ where: { email } });
        if (existing) return res.status(409).json({ message: 'Email already exists' });

        const rawPassword = password || Math.random().toString(36).slice(2, 10);
        const hashedPassword = await bcrypt.hash(rawPassword, 10);
        const csPkId = await getCsPrivilegePkId();

        const user = await prisma.user.create({
            data: {
                firstName,
                email,
                password: hashedPassword,
                // affiliationCode is unique in schema; do not set a shared label.
                accountApiKey: generateUuid(),
                emailVerifiedAt: new Date(),
                privilegeId: csPkId,
            },
            select: { id: true, email: true, firstName: true },
        });

        res.status(201).json({ message: 'Tutor created', user, password: rawPassword });
    } catch (e: any) {
        // Handle unique constraint violations gracefully (race conditions)
        if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
            return res.status(409).json({ message: 'Email already exists' });
        }
        logger.error(e);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const listTutors: RequestHandler = async (_req, res) => {
    try {
        const csPkId = await getCsPrivilegePkId();
        // Prefer privilege CS, but keep legacy users that have affiliationCode = 'tutor'
        const orConds: any[] = [{ affiliationCode: 'tutor' }];
        if (csPkId) orConds.push({ privilegeId: csPkId });

        const users = await prisma.user.findMany({
            where: {
                deletedAt: null,
                OR: orConds,
            },
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
        const isOnlyBroadcast = onlyBroadcast === '1' || onlyBroadcast === 'true' || 'yes';
        const skip = (page - 1) * pageSize;
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
                        const fbs = await prisma.courseFeedback.findMany({
                            where: { courseName: { in: names } },
                            select: { courseName: true },
                        });
                        feedbackNames = new Set(fbs.map((x) => x.courseName));
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
                    if (isReminder) type = 'reminder';
                    else if (feedbackNames.has(name)) type = 'feedback';
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

export const createDeviceNoSubscription: RequestHandler = async (req, res) => {
    try {
        const { name } = req.body as { name: string };
        if (!name) return res.status(400).json({ message: 'name is required' });
        const pkId = req.authenticatedUser.pkId;
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
