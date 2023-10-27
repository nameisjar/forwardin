import { RequestHandler } from 'express';
import prisma from '../utils/db';

export const checkSubscriptionQuota: RequestHandler = async (req, res, next) => {
    const userId = req.prismaUser.pkId;

    const subscription = await prisma.subscription.findFirst({
        where: { userId },
        orderBy: { startDate: 'desc' },
    });

    if (!subscription) {
        return res
            .status(404)
            .json({ message: 'No active subscription found. Please purchase one to continue.' });
    }

    if (subscription.endDate <= new Date()) {
        return res.status(403).json({ message: 'Subscription has expired' });
    }

    req.subscription = subscription;
    next();
};

export const isDeviceQuotaAvailable: RequestHandler = async (req, res, next) => {
    const subscription = req.subscription;

    if (subscription.deviceUsed >= subscription.deviceMax) {
        return res.status(403).json({ message: 'Device quota has been used up' });
    }

    next();
};
export const isAutoReplyQuotaAvailable: RequestHandler = async (req, res, next) => {
    const subscription = req.subscription;

    if (subscription.autoReplyUsed >= subscription.autoReplyMax) {
        return res.status(403).json({ message: 'Auto Reply quota has been used up' });
    }
    next();
};

export const isBroadcastQuotaAvailable: RequestHandler = async (req, res, next) => {
    const subscription = req.subscription;

    if (subscription.autoReplyUsed >= subscription.autoReplyMax) {
        return res.status(403).json({ message: 'Auto Reply quota has been used up' });
    }
    next();
};

export const isContactQuotaAvailable: RequestHandler = async (req, res, next) => {
    const subscription = req.subscription;

    if (subscription.contactUsed >= subscription.contactMax) {
        return res.status(403).json({ message: 'Contact quota has been used up' });
    }
    next();
};
