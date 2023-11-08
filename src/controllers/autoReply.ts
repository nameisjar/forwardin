import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getInstance, getJid } from '../whatsapp';
import logger from '../config/logger';

// back here: get recipients from contact labels or group
export const createAutoReplies: RequestHandler = async (req, res) => {
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
        const deviceId = req.query.deviceId as string;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        const autoReplies = await prisma.autoReply.findMany({
            where: {
                device: {
                    userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
                    id: deviceId,
                },
            },
        });
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
        });

        if (!autoReply) {
            return res.status(404).json({ error: 'Auto reply not found' });
        }

        res.json(autoReply);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateAutoReply: RequestHandler = async (req, res) => {
    const id = req.params.id;

    try {
        const { name, deviceId, recipients, requests, response } = req.body;

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

// back here: handle custom variables
// back here: if there's same request keyword
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendAutoReply(sessionId: any, data: any) {
    try {
        const session = getInstance(sessionId)!;
        const recipient = data.key.remoteJid;
        const jid = getJid(recipient);
        const name = data.pushName;
        const messageText =
            data.message?.conversation ||
            data.message?.extendedTextMessage?.text ||
            data.message?.imageMessage?.caption ||
            '';

        const matchingAutoReply = await prisma.autoReply.findFirst({
            where: {
                requests: {
                    has: messageText,
                },
                status: true,
                device: { sessions: { some: { sessionId } } },
            },
        });

        if (
            matchingAutoReply &&
            (matchingAutoReply.recipients.includes(recipient.split('@')[0]) ||
                matchingAutoReply.recipients.includes('*'))
        ) {
            const replyText = matchingAutoReply.response;
            // back here: send non-text message
            session.sendMessage(jid, { text: replyText.replace(/\{\{\$firstName\}\}/, name) });
            logger.warn(matchingAutoReply, 'auto reply response sent successfully');
        }
    } catch (error) {
        logger.error(error);
    }
}
