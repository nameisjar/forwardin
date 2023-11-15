import { RequestHandler } from 'express';
import prisma from '../utils/db';
import schedule from 'node-schedule';
import { getInstance, getJid } from '../whatsapp';
import logger from '../config/logger';
import { delay as delayMs } from '../utils/delay';
import { generateSlug } from '../utils/slug';

export const createBroadcast: RequestHandler = async (req, res) => {
    try {
        const { name, deviceId, recipients, message, schedule, delay } = req.body;

        if (
            recipients.includes('all') &&
            recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
                recipient.startsWith('label'),
            )
        ) {
            return res
                .status(400)
                .json({
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
            },
        });
        res.status(201).json({ message: 'Broadcast created successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: get sentCount, receivedCount, readCount, replyCount
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
                id: true,
                name: true,
                status: true,
                device: { select: { name: true } },
                createdAt: true,
                updatedAt: true,
            },
        });

        res.status(200).json(broadcasts);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// to do: broadcast detail
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
// to do: edit & delete broadcasts

// back here: send media
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
                        contactDevices: { select: { contact: { select: { phone: true } } } },
                    },
                },
            },
        });

        // back here: handle contact labels recipient, group recipient
        for (const broadcast of pendingBroadcasts) {
            const processedRecipients: (string | number)[] = [];
            const session = getInstance(broadcast.device.sessions[0].sessionId)!;
            const recipients: string[] = [];
            for (const recipient of broadcast.recipients) {
                // all == all contacts
                // label == contact labels
                // can't use "all" and "label" at the same time
                if (recipient.includes('all')) {
                    const contacts = await prisma.contact.findMany({});
                    contacts.map((c) => {
                        if (!recipients.includes(c.phone)) {
                            recipients.push(c.phone);
                        }
                    });
                } else if (recipient.includes('label')) {
                    const contactLabel = recipient.split('_')[1];

                    const contacts = await prisma.contact.findMany({
                        where: {
                            ContactLabel: { some: { label: { slug: generateSlug(contactLabel) } } },
                        },
                    });

                    contacts.map((c) => {
                        if (!recipients.includes(c.phone)) {
                            recipients.push(c.phone);
                        }
                    });
                } else if (recipient.includes('group')) {
                    const groupName = recipient.split('_')[1];
                    const group = await prisma.group.findFirst({
                        where: {
                            name: groupName,
                        },
                        include: {
                            contactGroups: { select: { contact: { select: { phone: true } } } },
                        },
                    });
                    group?.contactGroups.map((c) => {
                        if (!recipients.includes(c.contact.phone)) {
                            recipients.push(c.contact.phone);
                        }
                    });
                } else {
                    recipients.push(recipient);
                }
            }

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

                await session.sendMessage(
                    jid,
                    { text: broadcast.message },
                    { messageId: `BC_${broadcast.pkId}_${Date.now()}` },
                );

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
