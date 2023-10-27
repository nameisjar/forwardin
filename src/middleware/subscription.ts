import { RequestHandler } from 'express';
import prisma from '../utils/db';

export const isSubscriber: RequestHandler = async (req, res, next) => {
    const userId = req.prismaUser.pkId;

    const subscription = await prisma.subscription.findFirst({
        where: { userId },
    });

    if (userId && subscription && subscription.endDate > new Date()) {
        next();
    } else {
        res.status(403).json({ message: 'Access denied: Membership required' });
    }
};
