import { RequestHandler } from 'express';
import {
    getInstance,
    jidExists,
    sendButtonMessage,
    sendMediaFile,
    sendMediaFileToMultiple,
} from '../instance';
import logger from '../config/logger';
import prisma, { serializePrisma } from '../utils/db';
import { delay as delayMs } from '../utils/delay';
import { proto } from '@whiskeysockets/baileys';
import upload from '../config/multer';

export const sendSingle: RequestHandler = async (req, res) => {
    try {
        const { jid, type = 'number', message, options } = req.body;
        const session = getInstance(req.params.sessionId)!;

        const exists = await jidExists(session, jid, type);
        if (!exists) return res.status(400).json({ error: 'JID does not exists' });

        const result = await session.sendMessage(jid, message, options);
        res.status(200).json(result);
    } catch (e) {
        const message = 'An error occured during message send';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};

export const sendImage: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;

        upload.single('image')(req, res, async (err) => {
            if (err) {
                const message = 'An error occurred during file upload';
                logger.error(err, message);
                return res.status(500).json({ error: message });
            }

            const data = await sendMediaFile(
                session,
                req.body.id,
                {
                    mimetype: req.file?.mimetype,
                    buffer: req.file?.buffer,
                    originalname: req.file?.originalname,
                },
                'image',
                req.body?.caption,
                req.file?.originalname,
            );
            return res.status(201).json({ error: false, data: data });
        });
    } catch (e) {
        const message = 'An error occured during message send';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};

export const sendBulk: RequestHandler = async (req, res) => {
    const session = getInstance(req.params.sessionId)!;
    const results: { index: number; result: proto.WebMessageInfo | undefined }[] = [];
    const errors: { index: number; error: string }[] = [];

    for (const [
        index,
        { jid, type = 'number', delay = 1000, message, options },
    ] of req.body.entries()) {
        try {
            const exists = await jidExists(session, jid, type);
            if (!exists) {
                errors.push({ index, error: 'JID does not exists' });
                continue;
            }

            if (index > 0) await delayMs(delay);
            const result = await session.sendMessage(jid, message, options);
            results.push({ index, result });
        } catch (e) {
            const message = 'An error occured during message send';
            logger.error(e, message);
            errors.push({ index, error: message });
        }
    }

    res.status(req.body.length !== 0 && errors.length === req.body.length ? 500 : 200).json({
        results,
        errors,
    });
};

// back here: delay not working
export const sendImageToMultiple: RequestHandler = async (req, res) => {
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
            const captionText = req.body.caption || '';
            const fileName = req.file?.originalname || '';
            const delay = req.body.delay || 1000;

            if (recipients.length > 0) await delayMs(delay);
            const results = await sendMediaFileToMultiple(
                session,
                recipients,
                fileData,
                fileType,
                captionText,
                fileName,
            );

            return res.status(201).json({ error: false, data: results });
        });
    } catch (e) {
        const message = 'An error occurred during message send';
        logger.error(e, message);
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
    } catch (error) {
        logger.error('Error sending button message:', error);
        res.status(500).json({ success: false, error: 'Failed to send button message' });
    }
};

// back here: separate incoming and outgoing
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

// to do: send template message & personalization
// to do: auto reply (triggered by certain words)
// to do: scheduled send message(s)
