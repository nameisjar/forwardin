import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getInstance, getJid } from '../instance';
import logger from '../config/logger';

export const createAutoReply: RequestHandler = async (req, res) => {
    try {
        const { name, deviceId, recipients, requests, response } = req.body;

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
        const userId = req.userReq.pkId;

        const autoReplies = await prisma.autoReply.findMany({
            where: { device: { userId } },
        });
        res.json(autoReplies);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAutoReplyTemplateById: RequestHandler = async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const autoReply = await prisma.autoReply.findUnique({
            where: { pkId: id },
        });

        if (autoReply) {
            res.json(autoReply);
        } else {
            res.status(404).json({ error: 'Auto reply not found' });
        }
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateAutoReplyTemplate: RequestHandler = async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const { requests, response, status, deviceId } = req.body;

        const updatedAutoReply = await prisma.autoReply.update({
            where: { pkId: id },
            data: {
                requests,
                response,
                status,
                deviceId,
                updatedAt: new Date(),
            },
        });

        res.json(updatedAutoReply);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteAutoReplyTemplate: RequestHandler = async (req, res) => {
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

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendAutoReply(sessionId: any, m: any) {
    try {
        const session = getInstance(sessionId)!;
        const msg = m.messages[0];
        const recipient = m.messages[0].key.remoteJid;
        const jid = getJid(recipient);
        const name = m.messages[0].pushName;
        const messageText = msg.message.conversation || msg.message.extendedTextMessage?.text || '';
        const matchingAutoReply = await prisma.autoReply.findFirst({
            where: {
                requests: {
                    has: messageText,
                },
                recipients: {
                    has: recipient.split('@')[0],
                },
                status: true,
            },
        });
        if (matchingAutoReply) {
            const replyText = matchingAutoReply.response;
            session.sendMessage(jid, { text: replyText.replace(/\{\{\$firstName\}\}/, name) });
        }
    } catch (error) {
        logger.error(error);
        throw error;
    }
}
