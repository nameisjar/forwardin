/* eslint-disable @typescript-eslint/no-explicit-any */
import { RequestHandler } from 'express';
import prisma from '../utils/db';
import schedule from 'node-schedule';
import { getInstance, getJid, sendMediaFile } from '../whatsapp';
import logger from '../config/logger';
import { delay as delayMs } from '../utils/delay';
import { getRecipients } from '../utils/recipients';
import { replaceVariables } from '../utils/variableHelper';
import { diskUpload } from '../config/multer';
import { encryptMessage, decryptMessage, decryptBroadcast, decryptBroadcasts, decryptOutgoingMessage } from '../utils/messageEncryption';
import { useBroadcast } from '../utils/quota';
import { isUUID } from '../utils/uuidChecker';
import fs from 'fs';
import { Prisma } from '@prisma/client';
import { 
    sendTextMessage, 
    sendMediaMessage, 
    detectMediaType,
    SendResult 
} from '../services/messageSender';
import {
    calculateNaturalDelay,
    showTypingIndicator,
    resetClusterState,
    loadNaturalDelayConfig,
    NaturalDelayResult,
} from '../services/naturalDelay';
import { redactPhone } from '../utils/logRedaction';
import { canDeviceSend, incrementMessageCount, recordRateLimitWithError } from '../services/signalDetector';

// Constants untuk retry mechanism
const MAX_ATTEMPTS = 5;
const COOLDOWN_SECONDS = 60;
const BASE_RETRY_DELAY = 2000; // 2 seconds
const MAX_RETRY_DELAY = 16000; // 16 seconds

// Helper: Extract messageId dari berbagai bentuk response WhatsApp
function extractMessageId(sentMessage: any): string | undefined {
    try {
        // Format 1: sentMessage.key.id
        if (sentMessage?.key?.id) return sentMessage.key.id;
        
        // Format 2: sentMessage.message.key.id
        if (sentMessage?.message?.key?.id) return sentMessage.message.key.id;
        
        // Format 3: Array response dari sendMediaFile
        if (Array.isArray(sentMessage)) {
            const first = sentMessage[0];
            if (first?.key?.id) return first.key.id;
            if (first?.result?.key?.id) return first.result.key.id;
        }
        
        // Format 4: Wrapped result
        if (sentMessage?.result?.key?.id) return sentMessage.result.key.id;
        
        return undefined;
    } catch (e) {
        logger.error({ error: e }, 'Failed to extract messageId');
        return undefined;
    }
}

// Helper: Check if error is transient (bisa di-retry)
function isTransientError(error: any): boolean {
    if (!error) return false;
    
    const errorString = String(error.message || error).toLowerCase();
    const transientKeywords = [
        'timeout',
        'econnreset',
        'econnrefused',
        'etimedout',
        'socket hang up',
        'network',
        'temporary',
    ];
    
    return transientKeywords.some(keyword => errorString.includes(keyword));
}

// Helper: Check if error is rate limit
function isRateLimitError(error: any): boolean {
    if (!error) return false;
    
    return (
        error?.data === 429 ||
        error?.output?.statusCode === 429 ||
        String(error.message || '').toLowerCase().includes('rate-overlimit') ||
        String(error.message || '').toLowerCase().includes('rate limit')
    );
}

// Helper: Generate jitter untuk exponential backoff
function getRetryDelay(attempt: number, baseDelay: number): number {
    const exponentialDelay = Math.min(baseDelay * Math.pow(2, attempt - 1), MAX_RETRY_DELAY);
    const jitter = Math.random() * 1000; // 0-1000ms jitter
    return Math.floor(exponentialDelay + jitter);
}

// Helper function untuk retry dengan exponential backoff + jitter
// 🔥 UPDATED: Menggunakan messageSender dengan rate limiter
async function sendMessageWithRetry(
    session: any,
    deviceId: string, // Tambah deviceId untuk rate limiter
    jid: string,
    textPayload: string,
    mediaPath: string | null,
    maxRetries = 3
): Promise<{ success: boolean; messageId?: string; error?: any; isRateLimit?: boolean }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let result: SendResult;
            
            if (mediaPath) {
                // Kirim dengan media menggunakan rate limiter
                const mediaType = detectMediaType(mediaPath);
                result = await sendMediaMessage(
                    session,
                    deviceId,
                    jid,
                    { url: mediaPath },
                    mediaType,
                    {
                        caption: textPayload,
                        fileName: mediaPath.split('/').pop(),
                    }
                );
            } else {
                // Kirim teks menggunakan rate limiter
                result = await sendTextMessage(session, deviceId, jid, textPayload);
            }

            if (!result.success) {
                logger.warn({ jid: redactPhone(jid), attempt, error: result.error }, 'Message send failed');
                
                // Check if it's a rate limit error
                const errorStr = String(result.error || '').toLowerCase();
                const isRateLimit = errorStr.includes('rate') || errorStr.includes('limit');
                
                if (attempt < maxRetries) {
                    const waitTime = getRetryDelay(attempt, BASE_RETRY_DELAY);
                    logger.warn({ jid: redactPhone(jid), attempt, waitTime }, `Retrying in ${waitTime}ms...`);
                    await delayMs(waitTime);
                    continue;
                }
                
                return { success: false, error: result.error, isRateLimit };
            }

            return { success: true, messageId: result.messageId };
            
        } catch (error: any) {
            const isRateLimit = isRateLimitError(error);
            const isTransient = isTransientError(error);
            const isLastAttempt = attempt === maxRetries;

            logger.error(
                { 
                    jid: redactPhone(jid), 
                    attempt, 
                    maxRetries,
                    isRateLimit, 
                    isTransient,
                    errorMessage: error?.message,
                    errorData: error?.data 
                },
                'Send message attempt failed'
            );

            // Retry logic
            if (!isLastAttempt && (isRateLimit || isTransient)) {
                const waitTime = getRetryDelay(attempt, BASE_RETRY_DELAY);
                logger.warn(
                    { jid: redactPhone(jid), attempt, waitTime, isRateLimit, isTransient },
                    `Retrying in ${waitTime}ms...`
                );
                await delayMs(waitTime);
                continue;
            }

            // Final failure
            return { 
                success: false, 
                error, 
                isRateLimit 
            };
        }
    }

    return { success: false, error: 'Max retries exceeded' };
}

// ============================================================================
// HTTP REQUEST HANDLERS
// ============================================================================

export const createBroadcast: RequestHandler = async (req, res) => {
    try {
        const subscription = req.subscription;
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }
            const { name, deviceId, recipients, message, schedule } = req.body;
            const delay = Number(req.body.delay) || 5000;

            // Validate recipients array
            if (!recipients || !Array.isArray(recipients) || recipients.length === 0) {
                return res.status(400).json({ message: 'Recipients must be a non-empty array' });
            }
            if (!recipients.every((r: unknown) => typeof r === 'string')) {
                return res.status(400).json({ message: 'All recipients must be strings' });
            }

            const normalizedName =
                typeof name === 'string' && name.trim() ? name.trim() : 'Broadcast';

            if (
                recipients.includes('all') &&
                recipients.some((recipient: string) =>
                    recipient.startsWith('label'),
                )
            ) {
                return res.status(400).json({
                    message:
                        "Recipients can't contain both all contacts and contact labels at the same input",
                });
            }

            const device = await prisma.device.findUnique({
                where: { id: deviceId },
                include: { sessions: { select: { sessionId: true } } },
            });

            if (!device) {
                return res.status(404).json({ message: 'Device not found' });
            }
            if (!device.sessions[0]) {
                return res.status(404).json({ message: 'Session not found' });
            }

            await prisma.$transaction(async (transaction) => {
                // Create broadcast with encrypted message
                const broadcast = await transaction.broadcast.create({
                    data: {
                        name: normalizedName,
                        message: encryptMessage(message),
                        schedule,
                        deviceId: device.pkId,
                        delay,
                        recipients: {
                            set: recipients,
                        },
                        mediaPath: req.file?.path,
                    },
                });

                // Resolve recipients and create BroadcastRecipient records
                const resolvedRecipients = await getRecipients({
                    recipients,
                    deviceId: device.pkId,
                });

                // De-duplicate recipients
                const uniqueRecipients = Array.from(new Set(resolvedRecipients));

                if (uniqueRecipients.length > 0) {
                    await transaction.broadcastRecipient.createMany({
                        data: uniqueRecipients.map((phone) => ({
                            broadcastId: broadcast.pkId,
                            phone: String(phone),
                            status: 'pending',
                        })),
                        skipDuplicates: true,
                    });
                }

                await useBroadcast(transaction, subscription);
                res.status(201).json({ message: 'Broadcast created successfully' });
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createBroadcastFeedback: RequestHandler = async (req, res) => {
    try {
        const { name, courseName, startLesson = 1, schedule, recipients, deviceId } = req.body;
        const delay = Number(req.body.delay) || 5000;

        if (!name || !courseName || !schedule || !recipients || !deviceId) {
            return res.status(400).json({ message: 'Missing required fields: name, courseName, schedule, recipients, deviceId' });
        }

        if (
            recipients.includes('all') &&
            recipients.some((recipient: string) => recipient.startsWith('label'))
        ) {
            return res.status(400).json({
                message: "Recipients can't contain both all contacts and contact labels",
            });
        }

        // Verify device exists AND belongs to current user (IDOR protection)
        const device = await prisma.device.findFirst({
            where: { 
                id: deviceId,
                userId: req.authenticatedUser.pkId,
            },
            include: { sessions: { select: { sessionId: true } } },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found or access denied' });
        }
        if (!device.sessions[0]) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const courseFeedbacks = await prisma.courseFeedback.findMany({
            where: {
                courseName,
                lesson: { gte: Number(startLesson) },
            },
            orderBy: { lesson: 'asc' },
        });

        if (courseFeedbacks.length === 0) {
            return res.status(404).json({ 
                message: 'No feedback lessons found for the specified course and start lesson' 
            });
        }

        const baseName = typeof name === 'string' && name.trim() ? name.trim() : 'Feedback';
        const taggedBaseName = /\[feedback\]/i.test(baseName)
            ? baseName
            : `${baseName} [Feedback]`;

        await prisma.$transaction(async (transaction) => {
            for (let i = 0; i < courseFeedbacks.length; i++) {
                const feedback = courseFeedbacks[i];
                const broadcastSchedule = new Date(schedule);
                broadcastSchedule.setDate(broadcastSchedule.getDate() + i * 7); // Weekly interval

                await transaction.broadcast.create({
                    data: {
                        name: `${taggedBaseName} - Lesson ${feedback.lesson} - ${courseName}`,
                        message: encryptMessage(feedback.message),
                        schedule: broadcastSchedule,
                        deviceId: device.pkId,
                        delay,
                        recipients: { set: recipients },
                        broadcastType: 'feedback', // ✅ Tambahkan broadcastType
                    },
                });
            }
        });

        res.status(201).json({ 
            message: 'Feedback broadcasts created successfully',
            totalBroadcasts: courseFeedbacks.length
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createBroadcastReminder: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }

            const { name, message, lessons, schedule, recipients, deviceId } = req.body;
            const delay = Number(req.body.delay) || 5000;

            if (!name || !message || !lessons || !schedule || !recipients || !deviceId) {
                return res.status(400).json({ message: 'Missing required fields: name, message, lessons, schedule, recipients, deviceId' });
            }

            if (
                recipients.includes('all') &&
                recipients.some((recipient: string) => recipient.startsWith('label'))
            ) {
                return res.status(400).json({
                    message: "Recipients can't contain both all contacts and contact labels",
                });
            }

            // Verify device exists AND belongs to current user (IDOR protection)
            const device = await prisma.device.findFirst({
                where: { 
                    id: deviceId,
                    userId: req.authenticatedUser.pkId,
                },
                include: { sessions: { select: { sessionId: true } } },
            });

            if (!device) {
                return res.status(404).json({ message: 'Device not found or access denied' });
            }
            if (!device.sessions[0]) {
                return res.status(404).json({ message: 'Session not found' });
            }

            const baseName = typeof name === 'string' && name.trim() ? name.trim() : 'Reminder';
            const taggedBaseName = /\[reminder\]/i.test(baseName)
                ? baseName
                : `${baseName} [Reminder]`;

            const totalLessons = Number(lessons);

            await prisma.$transaction(async (transaction) => {
                for (let i = 0; i < totalLessons; i++) {
                    const broadcastSchedule = new Date(schedule);
                    broadcastSchedule.setDate(broadcastSchedule.getDate() + i * 7); // Weekly interval

                    await transaction.broadcast.create({
                        data: {
                            name: `${taggedBaseName} - Week ${i + 1}`,
                            message: encryptMessage(message),
                            schedule: broadcastSchedule,
                            deviceId: device.pkId,
                            delay,
                            recipients: { set: recipients },
                            mediaPath: req.file?.path,
                            broadcastType: 'reminder', // ✅ Tambahkan broadcastType
                        },
                    });
                }
            });

            res.status(201).json({ 
                message: 'Reminder broadcasts created successfully',
                totalBroadcasts: totalLessons
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createBroadcastScheduled: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }

            const {
                name,
                recipients,
                message,
                recurrence,
                interval,
                startDate,
                endDate,
                deviceId,
            } = req.body;
            const delay = Number(req.body.delay) || 5000;

            if (
                !recurrence ||
                !['minute', 'hourly', 'daily', 'weekly', 'monthly'].includes(recurrence)
            ) {
                return res.status(400).json({ message: 'Invalid or missing recurrence type' });
            }

            if (!interval || isNaN(Number(interval)) || Number(interval) <= 0) {
                return res.status(400).json({ message: 'Interval must be a positive number' });
            }

            const normalizedStartDate = new Date(startDate);
            const normalizedEndDate = new Date(endDate);

            if (normalizedStartDate > normalizedEndDate) {
                return res.status(400).json({ message: 'Start date must be before end date' });
            }

            if (!deviceId) {
                return res.status(400).json({ message: 'Device ID is required' });
            }

            if (
                recipients.includes('all') &&
                recipients.some((recipient: string) =>
                    recipient.startsWith('label'),
                )
            ) {
                return res.status(400).json({
                    message:
                        "Recipients can't contain both all contacts and contact labels at the same input",
                });
            }

            const device = await prisma.device.findUnique({
                where: { id: deviceId },
                include: { sessions: { select: { sessionId: true } } },
            });

            if (!device) {
                return res.status(404).json({ message: 'Device not found' });
            }
            if (!device.sessions[0]) {
                return res.status(404).json({ message: 'Session not found' });
            }

            const baseName = typeof name === 'string' && name.trim() ? name.trim() : 'Recurrence';
            const taggedBaseName = /\[(recurrence|recurring)\]/i.test(baseName)
                ? baseName
                : `${baseName} [Recurrence]`;

            const broadcasts = [] as any[];
            let current = new Date(normalizedStartDate);
            const encryptedMessage = encryptMessage(message);

            while (current <= normalizedEndDate) {
                broadcasts.push({
                    name: taggedBaseName,
                    message: encryptedMessage,
                    schedule: new Date(current),
                    deviceId: device.pkId,
                    delay,
                    recipients: { set: recipients },
                    mediaPath: req.file?.path,
                    broadcastType: 'recurrence', // ✅ Tambahkan broadcastType
                });

                switch (recurrence) {
                    case 'minute':
                        current.setMinutes(current.getMinutes() + Number(interval));
                        break;
                    case 'hourly':
                        current.setHours(current.getHours() + Number(interval));
                        break;
                    case 'daily':
                        current.setDate(current.getDate() + Number(interval));
                        break;
                    case 'weekly':
                        current.setDate(current.getDate() + Number(interval) * 7);
                        break;
                    case 'monthly':
                        current.setMonth(current.getMonth() + Number(interval));
                        break;
                }
            }

            await prisma.$transaction(
                broadcasts.map((b) =>
                    prisma.broadcast.create({
                        data: b,
                    }),
                ),
            );

            res.status(201).json({
                message: 'Broadcasts created successfully',
                totalBroadcasts: broadcasts.length
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBroadcastsSummary: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string | undefined;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        if (!deviceId) {
            return res.status(400).json({ message: 'deviceId is required' });
        }

        // Resolve device pkId once to avoid relational filter on every query
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const now = new Date();
        const devicePkId = device.pkId;

        const [sent, inactive, scheduled] = await Promise.all([
            prisma.broadcast.count({ where: { deviceId: devicePkId, isSent: true } }),
            prisma.broadcast.count({ where: { deviceId: devicePkId, status: false } }),
            prisma.broadcast.count({
                where: {
                    deviceId: devicePkId,
                    isSent: false,
                    status: { not: false },
                    schedule: { gt: now },
                },
            }),
        ]);

        res.status(200).json({ sent, scheduled, inactive });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAllBroadcasts: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        if (!deviceId) {
            return res.status(400).json({ message: 'deviceId is required' });
        }

        // Resolve device pkId once (so broadcast queries hit idx_broadcast_device_* indexes)
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // --- Pagination / filtering ---
        const pageRaw = req.query.page as string | undefined;
        const pageSizeRaw = req.query.pageSize as string | undefined;
        const qRaw = (req.query.q as string | undefined) || '';
        const statusFilter = (req.query.status as string | undefined) || 'all';
        const sortBy = (req.query.sortBy as string | undefined) || 'schedule';
        const sortDir = ((req.query.sortDir as string | undefined) || 'asc').toLowerCase();

        // Backward compatible mode: if no page/pageSize specified, return full array (legacy behavior)
        const usePagination = !!(pageRaw || pageSizeRaw);
        const page = Math.max(1, Number(pageRaw || 1));
        const pageSize = Math.min(200, Math.max(1, Number(pageSizeRaw || 25)));

        const where: any = {
            deviceId: device.pkId,
        };

        if (qRaw.trim()) {
            // case-insensitive contains (accelerated by pg_trgm index)
            where.name = { contains: qRaw.trim(), mode: 'insensitive' };
        }

        const now = new Date();
        if (statusFilter === 'inactive') {
            where.status = false;
        } else if (statusFilter === 'sent') {
            where.isSent = true;
        } else if (statusFilter === 'upcoming') {
            where.isSent = false;
            where.status = { not: false };
            where.schedule = { gt: now };
        }

        const orderBy: any[] = [];
        if (sortBy === 'name') {
            orderBy.push({ name: sortDir === 'desc' ? 'desc' : 'asc' });
        } else {
            orderBy.push({ schedule: sortDir === 'desc' ? 'desc' : 'asc' });
        }
        // stable tie-breaker aligned with indexes
        orderBy.push({ pkId: 'desc' });

        const select = {
            pkId: true,
            id: true,
            name: true,
            status: true,
            recipients: true,
            deviceId: true,
            schedule: true,
            message: true,
            mediaPath: true,
            delay: true,
            sentCount: true,
            failedCount: true,
            attemptCount: true,
            lastAttemptAt: true,
            lastError: true,
            isSent: true,
            createdAt: true,
            updatedAt: true,
        };

        if (!usePagination) {
            const broadcasts = await prisma.broadcast.findMany({
                where,
                select,
                orderBy,
            });
            return res.status(200).json(decryptBroadcasts(broadcasts));
        }

        const [total, broadcasts] = await Promise.all([
            prisma.broadcast.count({ where }),
            prisma.broadcast.findMany({
                where,
                select,
                orderBy,
                skip: (page - 1) * pageSize,
                take: pageSize,
            }),
        ]);

        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        res.status(200).json({
            data: decryptBroadcasts(broadcasts),
            meta: {
                total,
                page,
                pageSize,
                totalPages,
                hasMore: page < totalPages,
            },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBroadcastNameGroups: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        if (!deviceId) {
            return res.status(400).json({ message: 'deviceId is required' });
        }

        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const page = Math.max(1, Number((req.query.page as string | undefined) || 1));
        const pageSize = Math.min(100, Math.max(1, Number((req.query.pageSize as string | undefined) || 10)));
        const qRaw = ((req.query.q as string | undefined) || '').trim();
        const statusFilter = (req.query.status as string | undefined) || 'all';
        const typeFilter = (req.query.type as string | undefined) || 'all'; // ✅ Tambahkan filter type

        const sortBy = (req.query.sortBy as string | undefined) || 'schedule';
        const sortDir = ((req.query.sortDir as string | undefined) || 'asc').toLowerCase();

        const now = new Date();

        // Apply filters on Broadcast rows, then group by name
        const where: any = { deviceId: device.pkId };
        if (qRaw) {
            where.name = { contains: qRaw, mode: 'insensitive' };
        }
        if (statusFilter === 'inactive') {
            where.status = false;
        } else if (statusFilter === 'sent') {
            where.isSent = true;
        } else if (statusFilter === 'upcoming') {
            where.isSent = false;
            where.status = { not: false };
            where.schedule = { gt: now };
        }

        // ✅ Tambahkan filter berdasarkan broadcastType
        if (typeFilter && typeFilter !== 'all') {
            where.broadcastType = typeFilter;
        }

        // Prisma groupBy for portability (avoid raw SQL/table mapping issues)
        // NOTE: Prisma type-level constraint untuk groupBy+orderBy bisa berbeda antar versi.
        // Untuk menghindari error build TS, kita tidak menggunakan orderBy di groupBy,
        // lalu sorting + pagination dilakukan di memory.

        type GroupRow = {
            name: string;
            _count: { _all: number };
            _min: { schedule: Date | null };
        };

        const groupRowsAllRaw = await prisma.broadcast.groupBy({
            by: ['name'],
            where,
            _count: { _all: true },
            _min: { schedule: true },
        });

        const groupRowsAll = groupRowsAllRaw as unknown as GroupRow[];

        // sort in-memory
        const sortedAll = groupRowsAll.slice().sort((a, b) => {
            if (sortBy === 'name') {
                return String(a.name || '').localeCompare(String(b.name || ''));
            }
            const sa = a._min.schedule ? new Date(a._min.schedule).getTime() : 0;
            const sb = b._min.schedule ? new Date(b._min.schedule).getTime() : 0;
            return sa - sb;
        });
        if (sortDir === 'desc') sortedAll.reverse();

        const total = sortedAll.length;
        const totalPages = Math.max(1, Math.ceil(total / pageSize));

        const start = (page - 1) * pageSize;
        const rows = sortedAll.slice(start, start + pageSize);

        const names = rows.map((g) => g.name);

        // Fetch a sample broadcast per name (earliest schedule) for summary fields
        const sampleRows = await Promise.all(
            names.map((name) =>
                prisma.broadcast.findFirst({
                    where: { ...where, name },
                    orderBy: [{ schedule: 'asc' }, { pkId: 'desc' }],
                    select: {
                        id: true,
                        name: true,
                        status: true,
                        recipients: true,
                        schedule: true,
                        message: true,
                        mediaPath: true,
                        isSent: true,
                        sentCount: true,
                        failedCount: true,
                        lastError: true,
                        broadcastType: true, // ✅ Tambahkan broadcastType
                    },
                }),
            ),
        );

        const sampleByName = new Map<string, any>();
        for (const s of sampleRows) {
            if (s?.name) sampleByName.set(s.name, s);
        }

        const data = rows.map((g) => {
            const sample = sampleByName.get(g.name);
            return {
                name: g.name,
                broadcastsCount: g._count._all,
                nextSchedule: g._min.schedule,
                sampleId: sample?.id || null,
                sampleStatus: sample?.status ?? null,
                sampleRecipients: sample?.recipients || [],
                sampleSchedule: sample?.schedule || g._min.schedule,
                sampleMessage: decryptMessage(sample?.message || null),
                sampleMediaPath: sample?.mediaPath || null,
                sampleIsSent: sample?.isSent || false,
                sampleSentCount: sample?.sentCount || 0,
                sampleFailedCount: sample?.failedCount || 0,
                sampleLastError: sample?.lastError || null,
                sampleType: sample?.broadcastType || null, // ✅ Tambahkan sampleType
            };
        });

        return res.status(200).json({
            data,
            meta: {
                total,
                page,
                pageSize,
                totalPages,
                hasMore: page < totalPages,
            },
        });
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBroadcast: RequestHandler = async (req, res) => {
    try {
        const broadcastId = req.params.broadcastId;

        if (!isUUID(broadcastId)) {
            return res.status(400).json({ message: 'Invalid broadcastId' });
        }

        const broadcast = await prisma.broadcast.findUnique({
            where: { id: broadcastId },
            select: {
                id: true,
                name: true,
                status: true,
                recipients: true,
                device: { select: { name: true } },
                schedule: true,
                mediaPath: true,
                message: true,
                sentCount: true,
                failedCount: true,
                attemptCount: true,
                lastAttemptAt: true,
                lastError: true,
            },
        });

        if (!broadcast) {
            return res.status(404).json('Broadcast not found');
        }

        // Decrypt message before returning
        res.status(200).json(decryptBroadcast(broadcast));
    } catch (error) {
        logger.error(error);
    }
};

export const getOutgoingBroadcasts: RequestHandler = async (req, res) => {
    try {
        const broadcastId = req.params.broadcastId;
        const status = req.query.status as string;

        if (!isUUID(broadcastId)) {
            return res.status(400).json({ message: 'Invalid broadcastId' });
        }

        const broadcast = await prisma.broadcast.findUnique({
            where: { id: broadcastId },
            select: {
                pkId: true,
                recipients: true,
                createdAt: true,
                updatedAt: true,
                schedule: true,
                device: { select: { sessions: { select: { sessionId: true } } } },
            },
        });

        if (!broadcast) {
            return res.status(404).json('Broadcast not found');
        }

        // ✅ FIX: Filter berdasarkan broadcastId (pkId) yang tersimpan di OutgoingMessage
        // Ini memastikan hanya mengambil pesan yang benar-benar dikirim oleh broadcast ini
        const whereClause: any = {
            broadcastId: broadcast.pkId,
        };

        if (status) {
            whereClause.status = status;
        }

        const outgoingBroadcasts = await prisma.outgoingMessage.findMany({
            where: whereClause,
            include: {
                contact: {
                    select: {
                        firstName: true,
                        lastName: true,
                        phone: true,
                        colorCode: true,
                        ContactLabel: { select: { label: { select: { name: true } } } },
                    },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        // Decrypt messages before returning
        const decryptedBroadcasts = outgoingBroadcasts.map(decryptOutgoingMessage);
        res.status(200).json({ outgoingBroadcasts: decryptedBroadcasts });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBrodcastReplies: RequestHandler = async (req, res) => {
    try {
        const broadcastId = req.params.broadcastId;

        if (!isUUID(broadcastId)) {
            return res.status(400).json({ message: 'Invalid broadcastId' });
        }

        const broadcast = await prisma.broadcast.findUnique({
            select: { recipients: true, createdAt: true },
            where: { id: broadcastId },
        });

        if (!broadcast) {
            return res.status(404).json('Broadcast not found');
        }

        const broadcastReplies = [];
        const recipients = await getRecipients(broadcast);

        for (const recipient of recipients) {
            const incomingMessages = await prisma.incomingMessage.findFirst({
                where: {
                    from: `${recipient}@s.whatsapp.net`,
                    updatedAt: {
                        gte: broadcast.createdAt,
                    },
                },
                orderBy: {
                    updatedAt: 'desc',
                },
                include: {
                    contact: {
                        select: {
                            firstName: true,
                            lastName: true,
                            phone: true,
                            colorCode: true,
                            ContactLabel: { select: { label: { select: { name: true } } } },
                        },
                    },
                },
            });
            if (incomingMessages) {
                broadcastReplies.push(incomingMessages);
            }
        }
        res.status(200).json({ broadcastReplies });
    } catch (error) {
        logger.error(error);
    }
};

export const updateBroadcast: RequestHandler = async (req, res) => {
    try {
        const id = req.params.id;

        if (!isUUID(id)) {
            return res.status(400).json({ message: 'Invalid broadcastId' });
        }

        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }
            const { name, deviceId, recipients, message, schedule } = req.body;
            const delay = Number(req.body.delay) || 5000;

            if (
                recipients.includes('all') &&
                recipients.some((recipient: string) =>
                    recipient.startsWith('label'),
                )
            ) {
                return res.status(400).json({
                    message:
                        "Recipients can't contain both all contacts and contact labels at the same input",
                });
            }

            const device = await prisma.device.findUnique({
                where: { id: deviceId },
                include: { sessions: { select: { sessionId: true } } },
            });

            if (!device) {
                return res.status(404).json({ message: 'Device not found' });
            }
            if (!device.sessions[0]) {
                return res.status(404).json({ message: 'Session not found' });
            }
            await prisma.broadcast.update({
                where: { id },
                data: {
                    name,
                    message,
                    schedule,
                    deviceId: device.pkId,
                    delay,
                    recipients: {
                        set: recipients,
                    },
                    isSent: new Date(schedule).getTime() < new Date().getTime() ? true : false,
                    mediaPath: req.file?.path,
                    updatedAt: new Date(),
                    // Reset retry fields saat update
                    attemptCount: 0,
                    lastAttemptAt: null,
                    sentCount: 0,
                    failedCount: 0,
                    lastError: null,
                },
            });
            res.status(201).json({ message: 'Broadcast updated successfully' });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateBroadcastStatus: RequestHandler = async (req, res) => {
    try {
        const id = req.params.id;
        const status = req.body.status;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;
        const isSuperAdmin = privilegeId === Number(process.env.SUPER_ADMIN_ID);

        if (!isUUID(id)) {
            return res.status(400).json({ message: 'Invalid broadcastId' });
        }

        // Verify ownership through device relationship
        const broadcast = await prisma.broadcast.findFirst({
            where: {
                id,
                device: isSuperAdmin ? undefined : { userId },
            },
        });

        if (!broadcast) {
            return res.status(404).json({ message: 'Broadcast not found' });
        }

        const updatedBroadcast = await prisma.broadcast.update({
            where: { pkId: broadcast.pkId },
            data: {
                status,
                updatedAt: new Date(),
            },
        });

        res.status(200).json(updatedBroadcast);
    } catch (error) {
        logger.error(error);
        res.status  (500).json({ message: 'Internal server error' });
    }
};

export const deleteBroadcasts: RequestHandler = async (req, res) => {
    const broadcastIds = req.body.broadcastIds;

    try {
        const groupPromises = broadcastIds.map(async (broadcastId: string) => {
            await prisma.broadcast.delete({
                where: { id: broadcastId },
            });
        });

        await Promise.all(groupPromises);
        res.status(200).json({ message: 'Broadcast(s) deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteBroadcastsByName: RequestHandler = async (req, res) => {
    try {
        const { name } = req.body;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        if (!name) {
            return res.status(400).json({ message: 'Broadcast name is required' });
        }

        // Untuk menjaga security + performa, scoped delete harus berdasarkan device.
        // UI Schedules selalu bekerja per device (device_selected_id), jadi kita ambil dari:
        // - req.query.deviceId (preferred)
        // - atau header x-device-id (fallback)
        const deviceUuid =
            (req.query.deviceId as string | undefined) ||
            (req.headers['x-device-id'] as string | undefined) ||
            '';

        if (!deviceUuid) {
            return res.status(400).json({ message: 'deviceId is required' });
        }

        // Resolve device pkId once (and enforce ownership for non-super-admin)
        const device = await prisma.device.findFirst({
            where: {
                id: deviceUuid,
                userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // Hanya hapus broadcast yang belum terkirim (isSent=false)
        const deletedBroadcasts = await prisma.broadcast.deleteMany({
            where: {
                deviceId: device.pkId,
                name,
                isSent: false, // PENTING: Hanya hapus yang belum terkirim
            },
        });

        if (deletedBroadcasts.count === 0) {
            return res.status(404).json({
                message:
                    'Tidak ada jadwal yang dapat dihapus. Semua jadwal dengan nama ini sudah terkirim atau tidak ditemukan.',
            });
        }

        logger.info(
            { name, deviceId: deviceUuid, deletedCount: deletedBroadcasts.count },
            `Deleted ${deletedBroadcasts.count} unsent broadcasts with name: ${name}`,
        );

        res.status(200).json({
            message: `Berhasil menghapus ${deletedBroadcasts.count} jadwal yang belum terkirim`,
            deletedCount: deletedBroadcasts.count,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const bulkDeleteBroadcasts: RequestHandler = async (req, res) => {
    try {
        const isSentParam = (req.query.isSent as string | undefined)?.toLowerCase();
        const olderThanDaysRaw = req.query.olderThanDays as string | undefined;
        const cascadeParam = (req.query.cascade as string | undefined)?.toLowerCase();
        const deviceId = (req.query.deviceId as string | undefined) || undefined;

        const cascade =
            cascadeParam === undefined ? true : ['1', 'true', 'yes'].includes(cascadeParam);
        const olderThanDays = olderThanDaysRaw ? Math.max(0, Number(olderThanDaysRaw)) : undefined;

        let isSentFilter: boolean | undefined = undefined;
        if (isSentParam === 'true' || isSentParam === '1') isSentFilter = true;
        if (isSentParam === 'false' || isSentParam === '0') isSentFilter = false;

        if (isSentFilter === undefined && olderThanDays === undefined) {
            isSentFilter = true;
        }

        const where: any = {
            device: {
                userId:
                    req.privilege.pkId !== Number(process.env.SUPER_ADMIN_ID)
                        ? req.authenticatedUser.pkId
                        : undefined,
                id: deviceId,
            },
        };
        if (typeof isSentFilter === 'boolean') where.isSent = isSentFilter;
        if (olderThanDays !== undefined) {
            const threshold = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);
            where.createdAt = { lt: threshold };
        }

        const candidatesFull = await prisma.broadcast.findMany({
            select: { pkId: true, mediaPath: true },
            where,
        });
        if (!candidatesFull.length) {
            return res.status(200).json({
                message: 'No broadcasts matched the criteria',
                broadcastsDeleted: 0,
                outgoingDeleted: 0,
                mediaDeleted: 0,
            });
        }
        const pkIds = candidatesFull.map((c) => c.pkId);
        const mediaPaths = Array.from(
            new Set(
                candidatesFull
                    .map((c) => c.mediaPath)
                    .filter((p): p is string => !!p && typeof p === 'string'),
            ),
        );
        let outgoingDeleted = 0;

        await prisma.$transaction(async (tx) => {
            if (cascade) {
                const chunkSize = 50;
                for (let i = 0; i < pkIds.length; i += chunkSize) {
                    const chunk = pkIds.slice(i, i + chunkSize);
                    const orConds = chunk.map((pk) => ({ id: { startsWith: `BC_${pk}_` } }));
                    const resDel = await tx.outgoingMessage.deleteMany({ where: { OR: orConds } });
                    outgoingDeleted += resDel.count;
                }
            }
            await tx.broadcast.deleteMany({ where: { pkId: { in: pkIds } } });
        });

        let mediaDeleted = 0;
        for (const p of mediaPaths) {
            try {
                await fs.promises.unlink(p);
                mediaDeleted++;
            } catch {
                // File may not exist or already deleted
            }
        }

        res.status(200).json({
            message: 'Bulk delete completed',
            broadcastsDeleted: pkIds.length,
            outgoingDeleted,
            mediaDeleted,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// ============================================================================
// SCHEDULER JOB - Runs every minute
// 🔥 UPDATED: Menggunakan Natural Delay untuk pola pengiriman lebih natural
// ============================================================================

schedule.scheduleJob('* * * * *', async () => {
    try {
        const now = new Date();
        const cooldownThreshold = new Date(now.getTime() - COOLDOWN_SECONDS * 1000);

        const pendingBroadcasts = await prisma.broadcast.findMany({
            where: {
                schedule: { lte: now },
                status: true,
                isSent: false,
                attemptCount: { lt: MAX_ATTEMPTS },
                OR: [
                    { lastAttemptAt: null },
                    { lastAttemptAt: { lt: cooldownThreshold } }
                ]
            },
            include: {
                device: {
                    select: {
                        pkId: true,
                        id: true,
                        sessions: { select: { sessionId: true } },
                        contactDevices: { select: { contact: true } },
                    },
                },
            },
        });

        if (pendingBroadcasts.length === 0) {
            logger.debug('No pending broadcasts to process');
            return;
        }

        logger.info(`Found ${pendingBroadcasts.length} pending broadcasts to process`);

        // Load natural delay config sekali untuk semua broadcasts
        const naturalDelayConfig = loadNaturalDelayConfig();

        for (const broadcast of pendingBroadcasts) {
            const sessionId = broadcast.device.sessions[0]?.sessionId;
            const session = sessionId ? getInstance(sessionId) : null;
            
            // CRITICAL: Jangan proses jika session tidak ada
            if (!session) {
                logger.warn(
                    { broadcastId: broadcast.id, attemptCount: broadcast.attemptCount },
                    'Session not found, skipping (will NOT increment attempt or mark sent)'
                );
                continue;
            }

            // 🔥 Check if device is healthy enough to send messages
            const deviceCanSend = await canDeviceSend(broadcast.device.pkId);
            if (!deviceCanSend.allowed) {
                logger.warn(
                    { 
                        broadcastId: broadcast.id, 
                        deviceId: broadcast.device.id,
                        reason: deviceCanSend.reason 
                    },
                    'Device is paused or unhealthy, skipping broadcast'
                );
                continue;
            }

            // � ATOMIC LOCK: Coba acquire lock sebelum proses
            // Ini mencegah race condition jika scheduler run >1 menit
            const lockAcquired = await prisma.broadcast.updateMany({
                where: {
                    id: broadcast.id,
                    isSent: false,
                    // Hanya lock jika belum diproses dalam 2 menit terakhir
                    OR: [
                        { lastAttemptAt: null },
                        { lastAttemptAt: { lt: new Date(Date.now() - 2 * 60 * 1000) } }
                    ]
                },
                data: {
                    attemptCount: { increment: 1 },
                    lastAttemptAt: new Date(),
                },
            });

            // Jika tidak bisa acquire lock, skip (sudah diproses oleh worker lain)
            if (lockAcquired.count === 0) {
                logger.info(
                    { broadcastId: broadcast.id },
                    'Broadcast already being processed by another worker, skipping'
                );
                continue;
            }

            // 🔥 Reset cluster state untuk broadcast baru
            resetClusterState(broadcast.device.id);

            const currentAttempt = (broadcast.attemptCount || 0) + 1;
            logger.info(
                { broadcastId: broadcast.id, attempt: currentAttempt, maxAttempts: MAX_ATTEMPTS },
                `Processing broadcast attempt ${currentAttempt}/${MAX_ATTEMPTS}`
            );

            let successCount = 0;
            let failCount = 0;
            let rateLimitCount = 0;
            const errors: string[] = [];
            
            // 🔥 QUICK WIN: Consecutive failure detection untuk early ban detection
            let consecutiveFailures = 0;
            const MAX_CONSECUTIVE_FAILURES = 5;
            let broadcastStopped = false;

            // 🔥 ATOMIC PROCESSING: Query pending recipients from BroadcastRecipient table
            // This ensures crash recovery - only pending recipients will be processed on retry
            const pendingRecipients = await prisma.broadcastRecipient.findMany({
                where: {
                    broadcastId: broadcast.pkId,
                    status: { in: ['pending', 'failed'] }, // Retry failed ones too
                },
                orderBy: { pkId: 'asc' },
            });

            // Fallback: If no BroadcastRecipient records exist (old broadcasts), create them
            if (pendingRecipients.length === 0) {
                const rawRecipients = await getRecipients(broadcast);
                const uniqueRecipients = Array.from(new Set(rawRecipients));
                
                if (uniqueRecipients.length > 0) {
                    // Check if any records exist at all (could be all sent already)
                    const existingCount = await prisma.broadcastRecipient.count({
                        where: { broadcastId: broadcast.pkId },
                    });

                    if (existingCount === 0) {
                        // Old broadcast without BroadcastRecipient records - migrate
                        logger.info(
                            { broadcastId: broadcast.id, recipientCount: uniqueRecipients.length },
                            'Migrating old broadcast: creating BroadcastRecipient records'
                        );
                        await prisma.broadcastRecipient.createMany({
                            data: uniqueRecipients.map((phone) => ({
                                broadcastId: broadcast.pkId,
                                phone: String(phone),
                                status: 'pending',
                            })),
                            skipDuplicates: true,
                        });
                        // Re-fetch after creation
                        const newPendingRecipients = await prisma.broadcastRecipient.findMany({
                            where: {
                                broadcastId: broadcast.pkId,
                                status: 'pending',
                            },
                            orderBy: { pkId: 'asc' },
                        });
                        pendingRecipients.push(...newPendingRecipients);
                    } else {
                        // All recipients already processed - mark as complete
                        logger.info(
                            { broadcastId: broadcast.id },
                            'All recipients already processed - marking broadcast as sent'
                        );
                        await prisma.broadcast.update({
                            where: { id: broadcast.id },
                            data: { isSent: true, updatedAt: new Date() },
                        });
                        continue;
                    }
                }
            }

            logger.info(
                { broadcastId: broadcast.id, pendingCount: pendingRecipients.length },
                `Processing ${pendingRecipients.length} pending recipients`
            );

            // Skip if no pending recipients
            if (pendingRecipients.length === 0) {
                logger.info(
                    { broadcastId: broadcast.id },
                    'No pending recipients - marking broadcast as sent'
                );
                await prisma.broadcast.update({
                    where: { id: broadcast.id },
                    data: { isSent: true, updatedAt: new Date() },
                });
                continue;
            }

            for (let i = 0; i < pendingRecipients.length; i++) {
                const recipientRecord = pendingRecipients[i];
                const recipient = recipientRecord.phone;
                const isLastRecipient = i === pendingRecipients.length - 1;
                const jid = getJid(recipient);

                // 🔒 DOUBLE-CHECK: Pastikan recipient belum terkirim (race condition protection)
                const currentStatus = await prisma.broadcastRecipient.findUnique({
                    where: { pkId: recipientRecord.pkId },
                    select: { status: true },
                });
                
                if (currentStatus?.status === 'sent' || currentStatus?.status === 'sending') {
                    logger.debug(
                        { broadcastId: broadcast.id, phone: recipient, status: currentStatus.status },
                        'Recipient already sent/sending, skipping'
                    );
                    continue;
                }

                // 🔥 Mark as 'sending' before attempting (crash protection)
                await prisma.broadcastRecipient.update({
                    where: { pkId: recipientRecord.pkId },
                    data: { status: 'sending', jid, updatedAt: new Date() },
                });

                const variables = {
                    firstName:
                        broadcast.device.contactDevices.find((cd: any) => cd.contact.phone == recipient)
                            ?.contact.firstName ?? undefined,
                    lastName:
                        broadcast.device.contactDevices.find((cd: any) => cd.contact.phone == recipient)
                            ?.contact.lastName ?? undefined,
                    phoneNumber:
                        broadcast.device.contactDevices.find((cd: any) => cd.contact.phone == recipient)
                            ?.contact.phone ?? undefined,
                    email:
                        broadcast.device.contactDevices.find((cd: any) => cd.contact.phone == recipient)
                            ?.contact.email ?? undefined,
                };

                // 🔐 Decrypt message sebelum dikirim ke WhatsApp
                let decryptedMessage = '';
                try {
                    decryptedMessage = decryptMessage(broadcast.message) || '';
                } catch (err) {
                    logger.error({ err, broadcastId: broadcast.id }, 'Failed to decrypt message, using original');
                    decryptedMessage = broadcast.message;
                }
                const textPayload = replaceVariables(decryptedMessage, variables);

                // 🔥 Hitung natural delay SEBELUM kirim pesan
                // Ini termasuk: jitter, cluster, progressive, typing simulation
                const naturalDelay = calculateNaturalDelay(
                    broadcast.device.id,
                    broadcast.delay, // base delay dari broadcast config
                    textPayload.length, // panjang pesan untuk typing simulation
                    naturalDelayConfig
                );

                // 🔥 Tampilkan typing indicator atau delay sebelum kirim pesan
                // TYPING_INDICATOR_ENABLED=true → tampil "sedang mengetik..." + delay
                // TYPING_INDICATOR_ENABLED=false → hanya delay tanpa indicator
                if (naturalDelay.shouldShowTypingIndicator) {
                    await showTypingIndicator(
                        session, 
                        jid, 
                        naturalDelay.typingIndicatorDuration,
                        naturalDelay.showIndicatorInWhatsApp
                    );
                }

                // Send dengan retry mechanism
                const result = await sendMessageWithRetry(
                    session,
                    broadcast.device.id,
                    jid,
                    textPayload,
                    broadcast.mediaPath,
                    3 // max retries per message
                );

                if (!result.success) {
                    consecutiveFailures++;
                    
                    if (result.isRateLimit) {
                        rateLimitCount++;
                        errors.push(`Rate limit: ${jid}`);
                        
                        // 🔥 Record rate limit signal with error details for better classification
                        recordRateLimitWithError(broadcast.device.pkId, result.error).catch((err) => {
                            logger.error({ err }, 'Failed to record rate limit signal');
                        });
                    } else {
                        errors.push(`Failed: ${jid} - ${result.error?.message || 'Unknown'}`);
                    }
                    
                    failCount++;

                    // 🔥 QUICK WIN: Stop broadcast jika 5x gagal berturut-turut
                    if (consecutiveFailures >= MAX_CONSECUTIVE_FAILURES) {
                        logger.error(
                            { 
                                broadcastId: broadcast.id, 
                                deviceId: broadcast.device.id,
                                consecutiveFailures,
                                lastError: result.error?.message,
                                processedCount: i + 1,
                                totalCount: pendingRecipients.length
                            },
                            '🛑 BROADCAST STOPPED: 5 consecutive failures detected - likely device issue or ban'
                        );
                        
                        // Record sebagai critical signal untuk tracking
                        recordRateLimitWithError(broadcast.device.pkId, {
                            message: `Broadcast stopped: ${consecutiveFailures} consecutive failures - possible ban`,
                            data: 500
                        }).catch((err) => {
                            logger.error({ err }, 'Failed to record consecutive failure signal');
                        });
                        
                        errors.push(`STOPPED: ${consecutiveFailures} consecutive failures detected`);
                        broadcastStopped = true;
                        break; // EXIT LOOP
                    }

                    // 🔥 ATOMIC: Update recipient status to 'failed'
                    await prisma.broadcastRecipient.update({
                        where: { pkId: recipientRecord.pkId },
                        data: {
                            status: 'failed',
                            errorMsg: result.error?.message || 'Send failed',
                            retryCount: { increment: 1 },
                            updatedAt: new Date(),
                        },
                    });
                    
                    // 🔥 Gunakan natural delay meskipun gagal
                    if (!isLastRecipient) {
                        logger.debug(
                            { 
                                jid, 
                                delay: naturalDelay.totalDelay,
                                breakdown: naturalDelay.breakdown,
                                isClusterEnd: naturalDelay.isClusterEnd
                            },
                            '[Broadcast] Applying natural delay after failed send'
                        );
                        await delayMs(naturalDelay.totalDelay);
                    }
                    continue;
                }
                
                // 🔥 Reset consecutive failures on success
                consecutiveFailures = 0;

                const messageId = result.messageId!;
                logger.info(
                    { 
                        broadcastId: broadcast.id, 
                        messageId, 
                        recipient: jid,
                        naturalDelay: naturalDelay.totalDelay,
                        isClusterEnd: naturalDelay.isClusterEnd
                    }, 
                    'Message sent successfully'
                );

                // Save to OutgoingMessage
                try {
                    const contact = broadcast.device.contactDevices.find(
                        (cd: any) => cd.contact.phone == recipient
                    )?.contact;

                    await prisma.outgoingMessage.upsert({
                        where: { id: messageId },
                        update: { 
                            waMessageId: messageId, 
                            updatedAt: new Date(),
                            readBy: [],
                            status: 'pending'
                        },
                        create: {
                            id: messageId,
                            waMessageId: messageId,
                            to: jid,
                            message: encryptMessage(textPayload),
                            schedule: new Date(),
                            status: 'pending',
                            sessionId,
                            contactId: contact?.pkId ?? null,
                            mediaPath: broadcast.mediaPath || null,
                            broadcastId: broadcast.pkId,
                            broadcastType: broadcast.broadcastType || null,
                            isGroup: jid.includes('@g.us'),
                        },
                    });

                    // 🔥 ATOMIC: Update recipient status to 'sent'
                    await prisma.broadcastRecipient.update({
                        where: { pkId: recipientRecord.pkId },
                        data: {
                            status: 'sent',
                            sentAt: new Date(),
                            messageId,
                            errorMsg: null,
                            updatedAt: new Date(),
                        },
                    });

                    // 🔥 Increment device message count for health tracking
                    await incrementMessageCount(broadcast.device.pkId);

                    successCount++;
                } catch (dbError) {
                    logger.error(
                        { error: dbError, messageId, recipient: jid },
                        'Failed to save OutgoingMessage'
                    );

                    // 🔥 ATOMIC: Even if DB save fails, message was sent - mark as sent with warning
                    await prisma.broadcastRecipient.update({
                        where: { pkId: recipientRecord.pkId },
                        data: {
                            status: 'sent',
                            sentAt: new Date(),
                            messageId,
                            errorMsg: 'Message sent but failed to save to OutgoingMessage',
                            updatedAt: new Date(),
                        },
                    });

                    failCount++;
                }

                // 🔥 Gunakan natural delay (bukan delay konstan)
                if (!isLastRecipient) {
                    logger.debug(
                        { 
                            jid, 
                            delay: naturalDelay.totalDelay,
                            breakdown: naturalDelay.breakdown,
                            isClusterEnd: naturalDelay.isClusterEnd
                        },
                        '[Broadcast] Applying natural delay'
                    );
                    await delayMs(naturalDelay.totalDelay);
                }
            }

            // Decision logic
            const allFailed = successCount === 0;
            const hasRateLimit = rateLimitCount > 0;
            const reachedMaxAttempts = currentAttempt >= MAX_ATTEMPTS;

            logger.info(
                {
                    broadcastId: broadcast.id,
                    successCount,
                    failCount,
                    rateLimitCount,
                    consecutiveFailures,
                    broadcastStopped,
                    attempt: currentAttempt,
                    maxAttempts: MAX_ATTEMPTS,
                },
                broadcastStopped 
                    ? '🛑 Broadcast stopped due to consecutive failures' 
                    : 'Broadcast processing completed'
            );

            // 🔥 If broadcast was stopped due to consecutive failures, mark as failed
            if (broadcastStopped) {
                await prisma.broadcast.update({
                    where: { id: broadcast.id },
                    data: {
                        sentCount: successCount,
                        failedCount: failCount,
                        lastError: `STOPPED: ${MAX_CONSECUTIVE_FAILURES} consecutive failures - possible device issue or ban`,
                        isSent: true, // Mark as processed (not pending)
                        updatedAt: new Date(),
                    },
                });
                continue; // Skip to next broadcast
            }

            // Update broadcast status
            const updateData: any = {
                sentCount: successCount,
                failedCount: failCount,
                lastError: errors.length > 0 ? errors.slice(0, 5).join('; ') : null,
                updatedAt: new Date(),
            };

            // Mark isSent=true hanya jika ADA yang berhasil
            if (successCount > 0) {
                updateData.isSent = true;
                logger.info(
                    { broadcastId: broadcast.id, successCount, failCount },
                    '✅ Broadcast marked as SENT (at least 1 success)'
                );
            } 
            else if (allFailed && !hasRateLimit && reachedMaxAttempts) {
                updateData.isSent = true;
                logger.error(
                    { broadcastId: broadcast.id, attemptCount: currentAttempt },
                    '❌ Broadcast marked as SENT (failed after max attempts, no rate limit)'
                );
            }
            else if (hasRateLimit && !reachedMaxAttempts) {
                logger.warn(
                    { broadcastId: broadcast.id, rateLimitCount, attemptCount: currentAttempt },
                    '⏳ Broadcast will retry (rate limit detected, not at max attempts yet)'
                );
            }
            else if (allFailed && hasRateLimit && reachedMaxAttempts) {
                updateData.isSent = true;
                logger.error(
                    { broadcastId: broadcast.id, rateLimitCount, attemptCount: currentAttempt },
                    '❌ Broadcast marked as SENT (rate limit persists after max attempts)'
                );
            }

            await prisma.broadcast.update({
                where: { id: broadcast.id },
                data: updateData,
            });
        }

        logger.debug('Broadcast job cycle completed');
    } catch (error) {
        logger.error(error, 'Error in broadcast scheduler job');
    }
});

// ============================================================================
// CLEANUP JOB - Reset stuck "sending" recipients every 5 minutes
// Handles server crashes that leave recipients in "sending" state forever
// ============================================================================

schedule.scheduleJob('*/5 * * * *', async () => {
    try {
        // Recipients stuck in "sending" for more than 5 minutes are considered crashed
        const stuckThreshold = new Date(Date.now() - 5 * 60 * 1000);

        const updated = await prisma.broadcastRecipient.updateMany({
            where: {
                status: 'sending',
                updatedAt: { lt: stuckThreshold },
            },
            data: {
                status: 'pending', // Reset to pending so it gets retried
                errorMsg: 'Reset from stuck sending state (server crash recovery)',
                retryCount: { increment: 1 },
                updatedAt: new Date(),
            },
        });

        if (updated.count > 0) {
            logger.warn(
                { count: updated.count, threshold: '5 minutes' },
                '🔄 Cleaned up stuck sending recipients - reset to pending for retry'
            );
        }
    } catch (error) {
        logger.error(error, 'Error in broadcast cleanup job');
    }
});
