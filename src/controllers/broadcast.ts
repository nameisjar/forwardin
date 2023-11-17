import { RequestHandler } from 'express';
import prisma from '../utils/db';
import schedule from 'node-schedule';
import { getInstance, getJid, sendMediaFile } from '../whatsapp';
import logger from '../config/logger';
import { delay as delayMs } from '../utils/delay';
import { getRecipients } from '../utils/recipients';
import { replaceVariables } from '../utils/variableHelper';
import { diskUpload } from '../config/multer';

export const createBroadcast: RequestHandler = async (req, res) => {
    try {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
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
                return res.status(401).json({ message: 'Device not found' });
            }
            if (!device.sessions[0]) {
                return res.status(400).json({ message: 'Session not found' });
            }

            await prisma.broadcast.create({
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
            res.status(201).json({ message: 'Broadcast created successfully' });
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

        const broadcast = await prisma.broadcast.findUnique({
            select: { recipients: true, createdAt: true },
            where: { id: broadcastId },
        });

        if (!broadcast) {
            return res.status(404).json('Broadcast not found');
        }

        const broadcastReplies = [];

        for (const recipient of broadcast.recipients) {
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

// to do: CRUD broadcast message template
export const updateBroadcast: RequestHandler = async (req, res) => {
    const id = req.params.id;
    try {
        const { name, deviceId, recipients, message, schedule, delay = 5000 } = req.body;

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
            return res.status(401).json({ message: 'Device not found' });
        }
        if (!device.sessions[0]) {
            return res.status(400).json({ message: 'Session not found' });
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
                updatedAt: new Date(),
            },
        });
        res.status(201).json({ message: 'Broadcast updated successfully' });
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

schedule.scheduleJob('*', async () => {
    try {
        const pendingBroadcasts = await prisma.broadcast.findMany({
            where: {
                schedule: {
                    lte: new Date(),
                },
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
            const session = getInstance(broadcast.device.sessions[0].sessionId)!;

            // get recipients util
            const recipients = await getRecipients(broadcast);

            // const recipients = broadcast.recipients.includes('all')
            //     ? broadcast.device.contactDevices.map((c) => c.contact.phone)
            //     : broadcast.recipients;

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
                        replaceVariables(broadcast.message, variables),
                        null,
                        `BC_${broadcast.pkId}_${Date.now()}`,
                    );
                } else {
                    await session.sendMessage(
                        jid,
                        { text: replaceVariables(broadcast.message, variables) },
                        { messageId: `BC_${broadcast.pkId}_${Date.now()}` },
                    );
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
