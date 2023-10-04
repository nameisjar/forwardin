import { RequestHandler } from 'express';
import {
    createInstance,
    deleteInstance,
    getInstance,
    getInstanceStatus,
    instanceExist,
} from '../instance';
import prisma from '../utils/db';
import { generateUuid } from '../utils/keyGenerator';

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

    if (instanceExist(sessionId)) {
        res.write(`data: ${JSON.stringify({ error: 'Session already exists' })}\n\n`);
        res.end();
        return;
    }
    createInstance({ sessionId, deviceId: existingDevice.pkId, res, SSE: true });
};

export const getSessionStatus: RequestHandler = async (req, res) => {
    const session = getInstance(req.params.sessionId)!;
    res.status(200).json({ status: getInstanceStatus(session) });
};

export const deleteSession: RequestHandler = async (req, res) => {
    await deleteInstance(req.params.sessionId);
    res.status(200).json({ message: 'Session deleted' });
};
