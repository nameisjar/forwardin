import { RequestHandler } from 'express';
import logger from '../config/logger';
import prisma from '../utils/db';

export const getOrder: RequestHandler = async (req, res) => {
    try {
        const customerServiceId = req.params.customerServiceId;
        const sessions = await prisma.session.findFirst({
            where: { device: { CustomerService: { id: customerServiceId } } },
        });

        if (!sessions) {
            return res.status(404).json({ message: 'Session for this customer service not found' });
        }

        const incomingMessageCount = await prisma.incomingMessage.count({
            where: { sessionId: sessions.sessionId },
        });

        const cs = await prisma.customerService.findUnique({
            where: { id: customerServiceId },
        });

        if (!cs) {
            return res.status(404).json({ message: 'Customer service not found' });
        }

        const completedOrderCount = await prisma.order.count({
            where: { status: 'complete', csId: cs.pkId },
        });

        const receivedOrderCount = await prisma.order.count({
            where: { status: 'pending', csId: cs.pkId },
        });

        res.status(200).json({ completedOrderCount, receivedOrderCount, incomingMessageCount });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getMessageStatistics: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string;
        const today = new Date();
        today.setHours(0, 0, 0, 0);

        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const sessions = await prisma.session.findFirst({
            where: { device: { id: deviceId } },
        });

        if (!sessions) {
            return res.status(404).json({ message: 'Session for this device not found' });
        }

        const todayIncomingMessageCount = await prisma.incomingMessage.count({
            where: {
                sessionId: sessions.sessionId,
                createdAt: {
                    gte: today,
                    lt: tomorrow,
                },
            },
        });

        const todayFailedMessageCount = await prisma.outgoingMessage.count({
            where: {
                sessionId: sessions.sessionId,
                status: '0',
                createdAt: {
                    gte: today,
                    lt: tomorrow,
                },
            },
        });

        const todayOutgoingMessageCount = await prisma.outgoingMessage.count({
            where: {
                sessionId: sessions.sessionId,
                createdAt: {
                    gte: today,
                    lt: tomorrow,
                },
            },
        });

        const incomingMessageCount = await prisma.incomingMessage.count({
            where: { sessionId: sessions.sessionId },
        });

        const failedMessageCount = await prisma.outgoingMessage.count({
            where: { sessionId: sessions.sessionId, status: '0' },
        });

        const outgoingMessageCount = await prisma.outgoingMessage.count({
            where: { sessionId: sessions.sessionId },
        });

        res.status(200).json({
            todayIncomingMessageCount,
            todayOutgoingMessageCount,
            todayFailedMessageCount,
            incomingMessageCount,
            outgoingMessageCount,
            failedMessageCount,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
