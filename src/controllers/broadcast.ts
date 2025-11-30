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
import { useBroadcast } from '../utils/quota';
import { isUUID } from '../utils/uuidChecker';
import fs from 'fs';

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
async function sendMessageWithRetry(
    session: any,
    jid: string,
    textPayload: string,
    mediaPath: string | null,
    maxRetries = 3
): Promise<{ success: boolean; messageId?: string; error?: any; isRateLimit?: boolean }> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
        try {
            let sentMessage;
            
            if (mediaPath) {
                const result = await sendMediaFile(
                    session,
                    [jid],
                    {
                        url: mediaPath,
                        newName: mediaPath.split('/').pop(),
                    },
                    ['jpg', 'png', 'jpeg'].includes(mediaPath.split('.').pop() || '')
                        ? 'image'
                        : 'document',
                    textPayload,
                    null,
                    undefined,
                );
                sentMessage = result.results?.[0]?.result || result;
            } else {
                sentMessage = await session.sendMessage(jid, { text: textPayload });
            }

            // Extract messageId dengan robust handling
            const messageId = extractMessageId(sentMessage);
            
            if (!messageId) {
                logger.warn({ jid, attempt }, 'No message ID returned from WhatsApp');
                return { success: false, error: 'No message ID returned' };
            }

            return { success: true, messageId };
            
        } catch (error: any) {
            const isRateLimit = isRateLimitError(error);
            const isTransient = isTransientError(error);
            const isLastAttempt = attempt === maxRetries;

            logger.error(
                { 
                    jid, 
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
                    { jid, attempt, waitTime, isRateLimit, isTransient },
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
            const delay = Number(req.body.delay) ?? 5000;

            if (
                recipients.includes('all') &&
                recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
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
                await transaction.broadcast.create({
                    data: {
                        name,
                        message,
                        schedule,
                        deviceId: device.pkId,
                        delay,
                        recipients: {
                            set: recipients,
                        },
                        mediaPath: req.file?.path,
                    },
                });
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
        const delay = Number(req.body.delay) ?? 5000;

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

        await prisma.$transaction(async (transaction) => {
            for (let i = 0; i < courseFeedbacks.length; i++) {
                const feedback = courseFeedbacks[i];
                const broadcastSchedule = new Date(schedule);
                broadcastSchedule.setDate(broadcastSchedule.getDate() + i * 7); // Weekly interval

                await transaction.broadcast.create({
                    data: {
                        name: `${name} - Lesson ${feedback.lesson}`,
                        message: feedback.message,
                        schedule: broadcastSchedule,
                        deviceId: device.pkId,
                        delay,
                        recipients: { set: recipients },
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
            const delay = Number(req.body.delay) ?? 5000;

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

            const totalLessons = Number(lessons);

            await prisma.$transaction(async (transaction) => {
                for (let i = 0; i < totalLessons; i++) {
                    const broadcastSchedule = new Date(schedule);
                    broadcastSchedule.setDate(broadcastSchedule.getDate() + i * 7); // Weekly interval

                    await transaction.broadcast.create({
                        data: {
                            name: `${name} - Week ${i + 1}`,
                            message,
                            schedule: broadcastSchedule,
                            deviceId: device.pkId,
                            delay,
                            recipients: { set: recipients },
                            mediaPath: req.file?.path,
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
            const delay = Number(req.body.delay) ?? 5000;

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
                recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
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

            const broadcasts = [] as any[];
            let current = new Date(normalizedStartDate);

            while (current <= normalizedEndDate) {
                broadcasts.push({
                    name,
                    message,
                    schedule: new Date(current),
                    deviceId: device.pkId,
                    delay,
                    recipients: { set: recipients },
                    mediaPath: req.file?.path,
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

export const getAllBroadcasts: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        const broadcasts = await prisma.broadcast.findMany({
            where: {
                device: {
                    userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
                    id: deviceId,
                },
            },
            select: {
                pkId: true,
                id: true,
                name: true,
                status: true,
                recipients: true,
                deviceId: true,
                device: { select: { name: true, sessions: { select: { sessionId: true } } } },
                sentCount: true,
                failedCount: true,
                attemptCount: true,
                lastAttemptAt: true,
                lastError: true,
                isSent: true,
                createdAt: true,
                updatedAt: true,
            },
        });

        const newBroadcasts = [];
        for (const bc of broadcasts) {
            const recipients = await getRecipients(bc);
            const recipientJids = recipients.map((r) => getJid(r));

            const timeWindow = new Date(bc.updatedAt);
            timeWindow.setMinutes(timeWindow.getMinutes() + 30);

            const sentCount = await prisma.outgoingMessage.count({
                where: {
                    sessionId: { in: bc.device.sessions?.map((s) => s.sessionId) || [] },
                    to: { in: recipientJids },
                    createdAt: {
                        gte: bc.createdAt,
                        lte: timeWindow,
                    },
                    status: 'server_ack',
                },
            });

            const receivedCount = await prisma.outgoingMessage.count({
                where: {
                    sessionId: { in: bc.device.sessions?.map((s) => s.sessionId) || [] },
                    to: { in: recipientJids },
                    createdAt: {
                        gte: bc.createdAt,
                        lte: timeWindow,
                    },
                    status: 'delivery_ack',
                },
            });

            const readCount = await prisma.outgoingMessage.count({
                where: {
                    sessionId: { in: bc.device.sessions?.map((s) => s.sessionId) || [] },
                    to: { in: recipientJids },
                    createdAt: {
                        gte: bc.createdAt,
                        lte: timeWindow,
                    },
                    status: 'read',
                },
            });

            const uniqueRecipients = new Set();
            for (const recipient of recipients) {
                const incomingMessagesCount = await prisma.incomingMessage.count({
                    where: {
                        from: `${recipient}@s.whatsapp.net`,
                        updatedAt: {
                            gte: bc.createdAt,
                        },
                    },
                });

                if (incomingMessagesCount > 0) {
                    uniqueRecipients.add(recipient);
                }
            }
            const uniqueRecipientsCount = uniqueRecipients.size;

            newBroadcasts.push({
                ...bc,
                sentCount: sentCount,
                receivedCount: receivedCount,
                readCount: readCount,
                repliesCount: uniqueRecipientsCount,
            });
        }

        res.status(200).json(newBroadcasts);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
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

        res.status(200).json(broadcast);
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
                device: { select: { sessions: { select: { sessionId: true } } } },
            },
        });

        if (!broadcast) {
            return res.status(404).json('Broadcast not found');
        }

        const recipients = await getRecipients(broadcast);
        const recipientJids = recipients.map((r) => getJid(r));

        const timeWindow = new Date(broadcast.updatedAt);
        timeWindow.setMinutes(timeWindow.getMinutes() + 30);

        const whereClause: any = {
            sessionId: { in: broadcast.device.sessions?.map((s) => s.sessionId) || [] },
            to: { in: recipientJids },
            createdAt: {
                gte: broadcast.createdAt,
                lte: timeWindow,
            },
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

        res.status(200).json({ outgoingBroadcasts });
    } catch (error) {
        logger.error(error);
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
            const delay = Number(req.body.delay) ?? 5000;

            if (
                recipients.includes('all') &&
                recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
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

        if (!isUUID(id)) {
            return res.status(400).json({ message: 'Invalid broadcastId' });
        }
        const updatedBroadcast = await prisma.broadcast.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        });

        res.status(200).json(updatedBroadcast);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
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

        // Hanya hapus broadcast yang belum terkirim (isSent=false)
        const deletedBroadcasts = await prisma.broadcast.deleteMany({
            where: {
                name,
                isSent: false, // PENTING: Hanya hapus yang belum terkirim
                device: {
                    userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
                },
            },
        });

        if (deletedBroadcasts.count === 0) {
            return res.status(404).json({ 
                message: 'Tidak ada jadwal yang dapat dihapus. Semua jadwal dengan nama ini sudah terkirim.' 
            });
        }

        logger.info(
            { name, deletedCount: deletedBroadcasts.count },
            `Deleted ${deletedBroadcasts.count} unsent broadcasts with name: ${name}`
        );

        res.status(200).json({ 
            message: `Berhasil menghapus ${deletedBroadcasts.count} jadwal yang belum terkirim`,
            deletedCount: deletedBroadcasts.count
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
                fs.unlinkSync(p);
                mediaDeleted++;
            } catch {}
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
// SCHEDULER JOB - Runs every 10 seconds
// ============================================================================

// Scheduler job setiap 10 detik
// '*/10 * * * * *',
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

            // Increment attemptCount & update lastAttemptAt SEBELUM proses
            await prisma.broadcast.update({
                where: { id: broadcast.id },
                data: {
                    attemptCount: { increment: 1 },
                    lastAttemptAt: new Date(),
                },
            });

            const currentAttempt = (broadcast.attemptCount || 0) + 1;
            logger.info(
                { broadcastId: broadcast.id, attempt: currentAttempt, maxAttempts: MAX_ATTEMPTS },
                `Processing broadcast attempt ${currentAttempt}/${MAX_ATTEMPTS}`
            );

            let successCount = 0;
            let failCount = 0;
            let rateLimitCount = 0;
            const errors: string[] = [];

            // Get & de-duplicate recipients
            const rawRecipients = await getRecipients(broadcast);
            const uniqueRecipients = Array.from(new Set(rawRecipients));
            
            if (uniqueRecipients.length !== rawRecipients.length) {
                logger.info(
                    { 
                        broadcastId: broadcast.id, 
                        original: rawRecipients.length, 
                        deduped: uniqueRecipients.length 
                    },
                    'Recipients de-duplicated'
                );
            }

            logger.info(
                { broadcastId: broadcast.id, recipientCount: uniqueRecipients.length },
                `Processing ${uniqueRecipients.length} unique recipients`
            );

            for (let i = 0; i < uniqueRecipients.length; i++) {
                const recipient = uniqueRecipients[i];
                const isLastRecipient = i === uniqueRecipients.length - 1;
                const jid = getJid(recipient);

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

                const textPayload = replaceVariables(broadcast.message, variables);

                // Send dengan retry mechanism
                const result = await sendMessageWithRetry(
                    session,
                    jid,
                    textPayload,
                    broadcast.mediaPath,
                    3 // max retries per message
                );

                if (!result.success) {
                    if (result.isRateLimit) {
                        rateLimitCount++;
                        errors.push(`Rate limit: ${jid}`);
                    } else {
                        errors.push(`Failed: ${jid} - ${result.error?.message || 'Unknown'}`);
                    }
                    
                    failCount++;
                    await delayMs(isLastRecipient ? 0 : broadcast.delay);
                    continue;
                }

                const messageId = result.messageId!;
                logger.info({ broadcastId: broadcast.id, messageId, recipient: jid }, 'Message sent successfully');

                // Save to OutgoingMessage
                try {
                    const contact = broadcast.device.contactDevices.find(
                        (cd: any) => cd.contact.phone == recipient
                    )?.contact;

                    await prisma.outgoingMessage.upsert({
                        where: { id: messageId },
                        update: { updatedAt: new Date() },
                        create: {
                            id: messageId,
                            to: jid,
                            message: textPayload,
                            schedule: new Date(),
                            status: 'pending',
                            sessionId,
                            contactId: contact?.pkId ?? null,
                            mediaPath: broadcast.mediaPath || null,
                            broadcastId: broadcast.pkId,
                            isGroup: jid.includes('@g.us'),
                        },
                    });

                    successCount++;
                } catch (dbError) {
                    logger.error(
                        { error: dbError, messageId, recipient: jid },
                        'Failed to save OutgoingMessage'
                    );
                    failCount++;
                }

                await delayMs(isLastRecipient ? 0 : broadcast.delay);
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
                    attempt: currentAttempt,
                    maxAttempts: MAX_ATTEMPTS,
                },
                'Broadcast processing completed'
            );

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
            // Jika semua gagal & bukan rate limit & sudah max attempts → mark sent untuk stop retry
            else if (allFailed && !hasRateLimit && reachedMaxAttempts) {
                updateData.isSent = true;
                logger.error(
                    { broadcastId: broadcast.id, attemptCount: currentAttempt },
                    '❌ Broadcast marked as SENT (failed after max attempts, no rate limit)'
                );
            }
            // Jika ada rate limit dan belum max attempts → JANGAN mark sent, biarkan retry
            else if (hasRateLimit && !reachedMaxAttempts) {
                logger.warn(
                    { broadcastId: broadcast.id, rateLimitCount, attemptCount: currentAttempt },
                    '⏳ Broadcast will retry (rate limit detected, not at max attempts yet)'
                );
            }
            // Semua gagal & rate limit & max attempts → mark sent
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
