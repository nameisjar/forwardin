import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const handleNotification: RequestHandler = async (req, res) => {
    try {
        const { order_id, transaction_id, transaction_time, gross_amount, user_id } = req.body;

        const transaction_time_iso = new Date(transaction_time).toISOString();

        const user = await prisma.user.findUnique({
            where: { id: user_id },
        });

        if (!user) {
            res.status(404).json({ message: 'User not found' });
        } else {
            await prisma.transaction.upsert({
                where: { id: transaction_id },
                create: {
                    name: order_id,
                    id: transaction_id,
                    paidPrice: gross_amount,
                    userId: user.pkId,
                    subscriptionId: 1,
                    createdAt: transaction_time_iso,
                },
                update: {
                    updatedAt: transaction_time_iso,
                },
            });

            res.status(200).json({ message: 'Transacation created successfully' });
        }
    } catch (error) {
        const message = 'An error occured during payment notification handling';
        logger.error(error, message);
        res.status(500).json({ error: message });
    }
};
