import { RequestHandler } from 'express';
import { getInstance, verifyJid, sendButtonMessage, sendMediaFile, getJid } from '../instance';
import logger from '../config/logger';
import prisma, { serializePrisma } from '../utils/db';
import { delay as delayMs } from '../utils/delay';
import { proto } from '@whiskeysockets/baileys';
import upload from '../config/multer';

export const sendMessages: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;

        const results: { index: number; result?: proto.WebMessageInfo }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [
            index,
            { recipient, type = 'number', delay = 5000, message, options },
        ] of req.body.entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, type);

                const startTime = new Date().getTime();
                if (index > 0) await delayMs(delay);
                const endTime = new Date().getTime();
                const delayElapsed = endTime - startTime;
                logger.info(`Delay of ${delay} milliseconds elapsed: ${delayElapsed} milliseconds`);

                const result = await session.sendMessage(jid, message, options);
                results.push({ index, result });
            } catch (e) {
                const message =
                    e instanceof Error ? e.message : 'An error occurred during message send';
                logger.error(e, message);
                errors.push({ index, error: message });
            }
        }

        res.status(errors.length > 0 ? 500 : 200).json({
            results,
            errors,
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'An error occurred during message send';
        logger.error(error, message);
        res.status(500).json({ error: message });
    }
};

export const sendImageMessages: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;

        upload.single('image')(req, res, async (err) => {
            if (err) {
                const message = 'An error occurred during file upload';
                logger.error(err, message);
                return res.status(500).json({ error: message });
            }

            const recipients: string[] = req.body.recipients || [];

            if (!recipients.length) {
                return res.status(400).json({ error: 'Recipient JIDs are required' });
            }

            const fileData = {
                mimetype: req.file?.mimetype,
                buffer: req.file?.buffer,
                originalname: req.file?.originalname,
            };

            const fileType = 'image';
            const caption = req.body.caption || '';
            const fileName = req.file?.originalname || '';
            const delay = req.body.delay || 1000;

            const startTime = new Date().getTime();
            if (recipients.length > 0) await delayMs(delay);
            const endTime = new Date().getTime();
            const delayElapsed = endTime - startTime;
            logger.info(`Delay of ${delay} milliseconds elapsed: ${delayElapsed} milliseconds`);

            const { results, errors } = await sendMediaFile(
                session,
                recipients,
                fileData,
                fileType,
                caption,
                fileName,
            );

            res.status(errors.length > 0 ? 500 : 200).json({
                results,
                errors,
            });
        });
    } catch (error) {
        const message =
            error instanceof Error ? error.message : 'An error occurred during message send';
        logger.error(error, message);
        res.status(500).json({ error: message });
    }
};

export const sendButton: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;
        const to = req.body.to;
        const data = req.body.data;

        const result = await sendButtonMessage(session, to, data);

        res.status(200).json({ success: true, result });
    } catch (e) {
        const message = e instanceof Error ? e.message : 'An error occurred during message send';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};

export const getMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { cursor = undefined, limit = 25 } = req.query;
        const messages = (
            await prisma.message.findMany({
                cursor: cursor ? { pkId: Number(cursor) } : undefined,
                take: Number(limit),
                skip: cursor ? 1 : 0,
                where: { sessionId },
            })
        ).map((m) => serializePrisma(m));

        res.status(200).json({
            data: messages,
            cursor:
                messages.length !== 0 && messages.length === Number(limit)
                    ? messages[messages.length - 1].pkId
                    : null,
        });
    } catch (e) {
        const message = 'An error occured during message list';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};

export const getIncomingMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { cursor = undefined, limit = 25, phoneNumber } = req.query;
        const messages = (
            await prisma.incomingMessage.findMany({
                cursor: cursor ? { pkId: Number(cursor) } : undefined,
                take: Number(limit),
                skip: cursor ? 1 : 0,
                where: {
                    sessionId,
                    from: phoneNumber ? phoneNumber.toString() + '@s.whatsapp.net' : undefined,
                },
                include: {
                    contact: {
                        select: { firstName: true, lastName: true, colorCode: true },
                    },
                },
            })
        ).map((m) => serializePrisma(m));

        const totalMessages = await prisma.incomingMessage.count({
            where: { sessionId },
        });

        res.status(200).json({
            data: messages,
            cursor:
                messages.length !== 0 && messages.length === Number(limit)
                    ? messages[messages.length - 1].pkId
                    : null,
            total: totalMessages,
        });
    } catch (e) {
        const message = 'An error occured during message list';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};

export const getOutgoingMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { cursor = undefined, limit = 25, phoneNumber } = req.query;
        const messages = (
            await prisma.outgoingMessage.findMany({
                cursor: cursor ? { pkId: Number(cursor) } : undefined,
                take: Number(limit),
                skip: cursor ? 1 : 0,
                where: {
                    sessionId,
                    to: phoneNumber ? phoneNumber.toString() + '@s.whatsapp.net' : undefined,
                },
                include: {
                    contact: {
                        select: { firstName: true, lastName: true, colorCode: true },
                    },
                },
            })
        ).map((m) => serializePrisma(m));

        const totalMessages = await prisma.outgoingMessage.count({
            where: { sessionId },
        });

        res.status(200).json({
            data: messages,
            cursor:
                messages.length !== 0 && messages.length === Number(limit)
                    ? messages[messages.length - 1].pkId
                    : null,
            total: totalMessages,
        });
    } catch (e) {
        const message = 'An error occured during message list';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};

export const getConversationMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { cursor = undefined, limit = 25, phoneNumber } = req.query;

        const incomingMessages = await prisma.incomingMessage.findMany({
            cursor: cursor ? { pkId: Number(cursor) } : undefined,
            take: Number(limit),
            skip: cursor ? 1 : 0,
            where: {
                sessionId,
                from: phoneNumber ? phoneNumber.toString() + '@s.whatsapp.net' : undefined,
            },
            include: {
                contact: {
                    select: { firstName: true, lastName: true, colorCode: true },
                },
            },
        });

        const outgoingMessages = await prisma.outgoingMessage.findMany({
            cursor: cursor ? { pkId: Number(cursor) } : undefined,
            take: Number(limit),
            skip: cursor ? 1 : 0,
            where: {
                sessionId,
                to: phoneNumber ? phoneNumber.toString() + '@s.whatsapp.net' : undefined,
            },
            include: {
                contact: {
                    select: { firstName: true, lastName: true, colorCode: true },
                },
            },
        });

        // Combine incoming and outgoing messages into one array
        const allMessages = [...incomingMessages, ...outgoingMessages];
        logger.warn(allMessages);

        // Sort the combined messages by timestamp (receivedAt or createdAt)
        allMessages.sort((a, b) => {
            const timestampA = a.createdAt;
            const timestampB = b.createdAt;
            return timestampA.getTime() - timestampB.getTime();
        });

        // Apply pagination
        const messages = allMessages.slice(0, Number(limit));
        const cursorId = messages.length > 0 ? messages[messages.length - 1].pkId : null;

        const totalMessages = incomingMessages.length + outgoingMessages.length;

        res.status(200).json({
            data: messages.map((m) => serializePrisma(m)),
            cursor: cursorId,
            total: totalMessages,
        });
    } catch (e) {
        const message = 'An error occurred during message list';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};
// to do: send template message & personalization
// to do: auto reply (triggered by certain words)
// to do: scheduled send message(s)
