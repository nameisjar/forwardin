import { RequestHandler } from 'express';
import { createInstance, deleteInstance, getInstance, getInstanceStatus } from '../instance';
import prisma from '../utils/db';

export const createSession: RequestHandler = async (req, res) => {
    try {
        const { sessionId, deviceId } = req.body;

        const existingDevice = await prisma.device.findUnique({
            where: { pkId: deviceId },
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

        createInstance({ sessionId, deviceId, res });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSessionStatus: RequestHandler = async (req, res) => {
    const session = getInstance(req.params.sessionId)!;
    res.status(200).json({ status: getInstanceStatus(session) });
};

export const deleteSession: RequestHandler = async (req, res) => {
    await deleteInstance(req.params.sessionId);
    res.status(200).json({ message: 'Session deleted' });
};
