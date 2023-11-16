import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getInstance, getJid } from '../whatsapp';
import logger from '../config/logger';
import { replaceVariables } from '../utils/variableHelper';
import { generateSlug } from '../utils/slug';

export const createAutoReplies: RequestHandler = async (req, res) => {
    try {
        const { name, deviceId, recipients, requests, response } = req.body;

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
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }
        const autoReply = await prisma.autoReply.create({
            data: {
                name,
                requests: {
                    set: requests,
                },
                response,
                deviceId: device.pkId,
                recipients: {
                    set: recipients,
                },
            },
        });
        res.status(201).json(autoReply);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAutoReplies: RequestHandler = async (req, res) => {
    try {
        const deviceId = (req.query.deviceId as string) || undefined;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        const autoRepliesRaw = await prisma.autoReply.findMany({
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
                recipients: true,
                device: { select: { name: true, contactDevices: { select: { contact: true } } } },
                createdAt: true,
                updatedAt: true,
            },
        });

        const autoReplies = [];
        for (const autoReply of autoRepliesRaw) {
            let numberOfRecipients = 0;
            for (const recipient of autoReply.recipients) {
                if (recipient.includes('all')) {
                    numberOfRecipients += autoReply.device.contactDevices.length;
                } else if (recipient.includes('label')) {
                    const contactLabel = recipient.split('_')[1];
                    const contactsCount = await prisma.contact.count({
                        where: {
                            ContactLabel: { some: { label: { slug: generateSlug(contactLabel) } } },
                        },
                    });
                    numberOfRecipients += contactsCount;
                } else if (recipient.includes('*')) {
                    numberOfRecipients = 999;
                } else {
                    numberOfRecipients += 1;
                }
            }
            const autoRepliesCount = {
                ...autoReply,
                recipientsCount: numberOfRecipients,
            };

            autoReplies.push(autoRepliesCount);
        }

        res.json(autoReplies);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAutoReply: RequestHandler = async (req, res) => {
    const id = req.params.id;

    try {
        const autoReply = await prisma.autoReply.findUnique({
            where: { id },
            select: { id: true, name: true, recipients: true, requests: true, response: true },
        });

        if (!autoReply) {
            return res.status(404).json({ error: 'Auto reply not found' });
        }

        res.status(200).json(autoReply);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAutoReplyRecipients: RequestHandler = async (req, res) => {
    const id = req.params.id;

    try {
        const autoReply = await prisma.autoReply.findUnique({
            where: { id },
        });

        if (!autoReply) {
            return res.status(404).json({ error: 'Auto reply not found' });
        }

        const recipients = await prisma.contact.findMany({
            where: {
                phone: { in: autoReply.recipients },
            },
            orderBy: {
                updatedAt: 'desc',
            },
            select: {
                firstName: true,
                lastName: true,
                phone: true,
                ContactLabel: { select: { label: { select: { name: true } } } },
            },
        });

        const recipientContactMap: { [key: string]: unknown } = {};

        for (const recipient of autoReply.recipients) {
            const contact = recipients.find((c) => c.phone === recipient);
            recipientContactMap[recipient] = contact || null;
        }

        res.json(recipientContactMap);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateAutoReply: RequestHandler = async (req, res) => {
    const id = req.params.id;

    try {
        const { name, deviceId, recipients, requests, response, status } = req.body;

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const updatedAutoReply = await prisma.autoReply.update({
            where: { id },
            data: {
                name,
                requests: {
                    set: requests,
                },
                response,
                status,
                deviceId: device.pkId,
                recipients: {
                    set: recipients,
                },
            },
        });

        res.json(updatedAutoReply);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteAutoReply: RequestHandler = async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        await prisma.autoReply.delete({
            where: { pkId: id },
        });

        res.status(204).end();
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: if there's same request keyword
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendAutoReply(sessionId: any, data: any) {
    try {
        const session = getInstance(sessionId)!;
        const recipient = data.key.remoteJid;
        const jid = getJid(recipient);
        const phoneNumber = recipient.split('@')[0];
        const name = data.pushName;
        const messageText =
            data.message?.conversation ||
            data.message?.extendedTextMessage?.text ||
            data.message?.imageMessage?.caption ||
            '';

        const matchingAutoReply = await prisma.autoReply.findFirst({
            where: {
                AND: [
                    {
                        requests: {
                            has: messageText,
                        },
                        status: true,
                        device: { sessions: { some: { sessionId } } },
                    },
                    {
                        OR: [
                            {
                                recipients: { has: phoneNumber },
                            },
                            { recipients: { has: '*' } },
                            {
                                recipients: { has: 'all' },
                                device: {
                                    contactDevices: { some: { contact: { phone: phoneNumber } } },
                                },
                            },
                        ],
                    },
                ],
            },
        });

        if (matchingAutoReply) {
            const replyText = matchingAutoReply.response;

            // back here: complete the provided variables
            const variables = {
                name: name,
                firstName: name,
            };

            // back here: send non-text message
            session.readMessages([data.key]);
            session.sendMessage(
                jid,
                { text: replaceVariables(replyText, variables) },
                { quoted: data },
            );
            logger.warn(matchingAutoReply, 'auto reply response sent successfully');
        }
    } catch (error) {
        logger.error(error);
    }
}
