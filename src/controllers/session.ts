import { RequestHandler } from 'express';
import {
    createInstance,
    deleteInstance,
    getInstance,
    getInstanceStatus,
    verifyInstance,
} from '../instance';
import prisma from '../utils/db';
import { generateUuid } from '../utils/keyGenerator';
import logger from '../config/logger';

// back here: api key == session id
export const createSession: RequestHandler = async (req, res) => {
    try {
        const { deviceId } = req.body;
        const sessionId = generateUuid();

        const existingDevice = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        const existingSession = await prisma.session.findFirst({
            where: { sessionId },
        });

        if (!existingDevice) {
            return res.status(404).json({ message: 'Device not found' });
        }

        if (existingSession) {
            return res.status(404).json({ message: 'Session already exist' });
        }

        createInstance({ sessionId, deviceId: existingDevice.pkId, res });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createSSE: RequestHandler = async (req, res) => {
    const { deviceId } = req.body;
    const sessionId = generateUuid();

    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
    });

    const existingDevice = await prisma.device.findUnique({
        where: { id: deviceId },
    });

    if (!existingDevice) {
        return res.status(404).json({ message: 'Device not found' });
    }

    if (verifyInstance(sessionId)) {
        res.write(`data: ${JSON.stringify({ error: 'Session already exists' })}\n\n`);
        res.end();
        return;
    }
    createInstance({ sessionId, deviceId: existingDevice.pkId, res, SSE: true });
};

export const getSessionStatus: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;
        res.status(200).json({ status: getInstanceStatus(session), session });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessions: RequestHandler = async (req, res) => {
    try {
        const pkId = req.user.pkId;

        const sessions = await prisma.session.findMany({
            where: {
                device: { user: { pkId } },
                id: { contains: 'config' },
            },
            select: {
                sessionId: true,
                device: { select: { id: true } },
            },
        });

        res.status(200).json(sessions);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessionsByDeviceApiKey: RequestHandler = async (req, res) => {
    try {
        const deviceApiKey = req.params.deviceApiKey;

        const existingDevice = await prisma.device.findUnique({
            where: {
                apiKey: deviceApiKey,
            },
        });

        if (!existingDevice) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // back here: get session logs
        const sessions = await prisma.session.findMany({
            where: {
                deviceId: existingDevice.pkId,
                id: { contains: 'config' },
            },
            select: {
                sessionId: true,
                data: true,
            },
        });

        if (!sessions) {
            return res.status(404).json({ message: 'Session not found' });
        }

        res.status(200).json(sessions);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteSession: RequestHandler = async (req, res) => {
    await deleteInstance(req.params.sessionId);
    res.status(200).json({ message: 'Session deleted' });
};
