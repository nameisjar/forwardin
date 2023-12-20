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

// to do: avg message per day
// avg conversation time
// incoming + outgoing + failed today message count per hour
// incoming + outgoing + failed lifetime message count per month
export const getMessageStatistics: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
        const endOfMonth = new Date(today.getFullYear(), today.getMonth() + 1, 0);

        console.log(startOfMonth);
        console.log(endOfMonth);

        const tomorrow = new Date(today);
        tomorrow.setDate(today.getDate() + 1);

        const sessions = await prisma.session.findFirst({
            where: { device: { id: deviceId } },
        });

        if (!sessions) {
            return res.status(404).json({ message: 'Session for this device not found' });
        }

        const thisMonthIncomingMessageCount = await prisma.incomingMessage.count({
            where: {
                sessionId: sessions.sessionId,
                createdAt: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                },
            },
        });

        const thisMonthFailedMessageCount = await prisma.outgoingMessage.count({
            where: {
                sessionId: sessions.sessionId,
                status: '0',
                createdAt: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                },
            },
        });

        const thisMonthOutgoingMessageCount = await prisma.outgoingMessage.count({
            where: {
                sessionId: sessions.sessionId,
                createdAt: {
                    gte: startOfMonth,
                    lte: endOfMonth,
                },
            },
        });

        console.log(
            thisMonthIncomingMessageCount,
            thisMonthFailedMessageCount,
            thisMonthOutgoingMessageCount,
        );

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

        const allIncomingMessageCount = await prisma.incomingMessage.count({
            where: { sessionId: sessions.sessionId },
        });

        const allFailedMessageCount = await prisma.outgoingMessage.count({
            where: { sessionId: sessions.sessionId, status: '0' },
        });

        const allOutgoingMessageCount = await prisma.outgoingMessage.count({
            where: { sessionId: sessions.sessionId },
        });

        const totalTodayMessages =
            todayIncomingMessageCount + todayOutgoingMessageCount + todayFailedMessageCount;
        const totalThisMonthMessages =
            thisMonthFailedMessageCount +
            thisMonthIncomingMessageCount +
            thisMonthOutgoingMessageCount;
        res.status(200).json({
            todayIncomingMessageCount,
            todayOutgoingMessageCount,
            todayFailedMessageCount,
            totalTodayMessages,
            totalThisMonthMessages,
            allIncomingMessageCount,
            allOutgoingMessageCount,
            allFailedMessageCount,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
