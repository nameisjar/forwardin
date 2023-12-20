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
