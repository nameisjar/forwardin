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

// back here: add deviceId param checker
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
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }

            const { courseName, startLesson = 1, recipients, deviceId } = req.body;
            const delay = Number(req.body.delay) ?? 5000;

            if (!courseName || !recipients || !deviceId) {
                return res.status(400).json({ message: 'Missing required fields' });
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

            const courseFeedbacks = await prisma.courseFeedback.findMany({
                where: {
                    courseName,
                    lesson: { gte: Number(startLesson) },
                },
                orderBy: { lesson: 'asc' },
            });

            if (courseFeedbacks.length === 0) {
                return res
                    .status(404)
                    .json({ message: 'No lessons found for the specified course' });
            }

            const now = new Date();

            await prisma.$transaction(async (transaction) => {
                for (let i = 0; i < courseFeedbacks.length; i++) {
                    const feedback = courseFeedbacks[i];
                    const schedule = new Date(now);
                    schedule.setDate(schedule.getDate() + i * 7);

                    await transaction.broadcast.create({
                        data: {
                            name: `${courseName} - Recipients ${recipients}`,
                            message: feedback.message,
                            schedule,
                            deviceId: device.pkId,
                            delay,
                            recipients: { set: recipients },
                            mediaPath: req.file?.path,
                        },
                    });
                }
            });

            res.status(201).json({ message: 'Broadcasts created successfully' });
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

            const { courseName, startLesson = 1, recipients, deviceId } = req.body;
            const delay = Number(req.body.delay) ?? 5000;

            if (!courseName || !recipients || !deviceId) {
                return res.status(400).json({ message: 'Missing required fields' });
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

            const courseReminders = await prisma.courseReminder.findMany({
                where: {
                    courseName,
                    lesson: { gte: Number(startLesson) },
                },
                orderBy: { lesson: 'asc' },
            });

            if (courseReminders.length === 0) {
                return res
                    .status(404)
                    .json({ message: 'No lessons found for the specified course' });
            }

            const now = new Date();

            await prisma.$transaction(async (transaction) => {
                for (let i = 0; i < courseReminders.length; i++) {
                    const reminder = courseReminders[i];
                    const schedule = new Date(now);
                    schedule.setDate(schedule.getDate() + i * 7);

                    await transaction.broadcast.create({
                        data: {
                            name: `${courseName} - Recipients ${recipients}`,
                            message: reminder.message,
                            schedule,
                            deviceId: device.pkId,
                            delay,
                            recipients: { set: recipients },
                            mediaPath: req.file?.path,
                        },
                    });
                }
            });

            res.status(201).json({ message: 'Broadcasts created successfully' });
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

            if (!startDate || isNaN(new Date(startDate).getTime())) {
                return res.status(400).json({ message: 'Invalid or missing start date' });
            }

            if (!endDate || isNaN(new Date(endDate).getTime())) {
                return res.status(400).json({ message: 'Invalid or missing end date' });
            }

            if (new Date(startDate) > new Date(endDate)) {
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

            const start = new Date(startDate);
            const end = new Date(endDate);
            const broadcasts = [] as any[];
            let current = new Date(start);

            while (current <= end) {
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
                totalBroadcasts: broadcasts.length,
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
                device: { select: { name: true } },
                createdAt: true,
                updatedAt: true,
            },
        });

        const newBroadcasts = [];
        for (const bc of broadcasts) {
            const sentCount = await prisma.outgoingMessage.count({
                where: { id: { contains: `BC_${bc.pkId}` }, status: 'server_ack' },
            });
            const receivedCount = await prisma.outgoingMessage.count({
                where: { id: { contains: `BC_${bc.pkId}` }, status: 'delivery_ack' },
            });
            const readCount = await prisma.outgoingMessage.count({
                where: { id: { contains: `BC_${bc.pkId}` }, status: 'read' },
            });

            const recipients = await getRecipients(bc);

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
            select: { pkId: true },
        });

        if (!broadcast) {
            return res.status(404).json('Broadcast not found');
        }

        const outgoingBroadcasts = await prisma.outgoingMessage.findMany({
            where: {
                id: { contains: `BC_${broadcast.pkId}` },
                status,
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

        // wait for all the Promises to settle (either resolve or reject)
        await Promise.all(groupPromises);

        res.status(200).json({ message: 'Broadcast(s) deleted successfully' });
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

        // If no filter provided, default to isSent=true for safety
        if (isSentFilter === undefined && olderThanDays === undefined) {
            isSentFilter = true;
        }

        const where: any = {
            // user scoping (same as getAllBroadcasts)
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

        // Find candidates
        const candidates = await prisma.broadcast.findMany({ select: { pkId: true }, where });
        if (!candidates.length) {
            return res
                .status(200)
                .json({
                    message: 'No broadcasts matched the criteria',
                    broadcastsDeleted: 0,
                    outgoingDeleted: 0,
                });
        }

        const pkIds = candidates.map((c) => c.pkId);
        let outgoingDeleted = 0;

        await prisma.$transaction(async (tx) => {
            if (cascade) {
                // Delete related outgoing messages in chunks to avoid huge OR clauses
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

        res.status(200).json({
            message: 'Bulk delete completed',
            broadcastsDeleted: pkIds.length,
            outgoingDeleted,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// run scheduler every minute instead of invalid pattern
schedule.scheduleJob('* * * * *', async () => {
    try {
        const pendingBroadcasts = await prisma.broadcast.findMany({
            where: {
                schedule: {
                    lte: new Date(),
                },
                status: true,
                isSent: false,
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

        // back here: fix processedRecipients
        for (const broadcast of pendingBroadcasts) {
            const processedRecipients: (string | number)[] = [];
            const sessionId = broadcast.device.sessions[0]?.sessionId;
            const session = sessionId ? getInstance(sessionId) : null;
            if (!session) {
                logger.warn({ broadcastId: broadcast.id }, 'Session not found, will retry later');
                continue;
            }

            // get recipients util
            const recipients = await getRecipients(broadcast);

            for (let i = 0; i < recipients.length; i++) {
                const recipient = recipients[i];
                const isLastRecipient = i === recipients.length - 1;

                if (processedRecipients.includes(recipient)) {
                    logger.info(
                        { message: 'Broadcast recipient has already been processed', recipient },
                        'skip broadcast',
                    );
                    continue;
                }

                const jid = getJid(recipient);

                const variables = {
                    firstName:
                        broadcast.device.contactDevices.filter(
                            (cd) => cd.contact.phone == recipient,
                        )[0]?.contact.firstName ?? undefined,
                    lastName:
                        broadcast.device.contactDevices.filter(
                            (cd) => cd.contact.phone == recipient,
                        )[0]?.contact.lastName ?? undefined,
                    phoneNumber:
                        broadcast.device.contactDevices.filter(
                            (cd) => cd.contact.phone == recipient,
                        )[0]?.contact.phone ?? undefined,
                    email:
                        broadcast.device.contactDevices.filter(
                            (cd) => cd.contact.phone == recipient,
                        )[0]?.contact.email ?? undefined,
                };

                // Generate deterministic outgoing message id and text
                const outgoingId = `BC_${broadcast.pkId}_${Date.now()}_${i}`;
                const textPayload = replaceVariables(broadcast.message, variables);

                if (broadcast.mediaPath) {
                    await sendMediaFile(
                        session,
                        [jid],
                        {
                            url: broadcast.mediaPath,
                            newName: broadcast.mediaPath.split('/').pop(),
                        },
                        ['jpg', 'png', 'jpeg'].includes(broadcast.mediaPath.split('.').pop() || '')
                            ? 'image'
                            : 'document',
                        textPayload,
                        null,
                        outgoingId,
                    );
                } else {
                    await session.sendMessage(
                        jid,
                        { text: textPayload },
                        { messageId: outgoingId },
                    );
                }

                // Ensure an OutgoingMessage record exists for admin history
                try {
                    const contact = broadcast.device.contactDevices.find(
                        (cd) => cd.contact.phone == recipient,
                    )?.contact;
                    await prisma.outgoingMessage.upsert({
                        where: { id: outgoingId },
                        update: { updatedAt: new Date() },
                        create: {
                            id: outgoingId,
                            to: jid,
                            message: textPayload,
                            schedule: new Date(),
                            status: 'pending',
                            sessionId,
                            contactId: contact?.pkId ?? null,
                        },
                    });
                } catch (e) {
                    logger.warn(e, 'Failed to upsert OutgoingMessage for broadcast');
                }

                processedRecipients.push(recipient);
                logger.info(
                    { message: 'Broadcast has just been processed', recipient },
                    'broadcast sent',
                );

                await delayMs(isLastRecipient ? 0 : broadcast.delay);
            }
            await prisma.broadcast.update({
                where: { id: broadcast.id },
                data: {
                    isSent: true,
                    updatedAt: new Date(),
                },
            });
        }
        logger.debug('Broadcast job is running...');
    } catch (error) {
        logger.error(error, 'Error processing scheduled broadcasts');
    }
});
