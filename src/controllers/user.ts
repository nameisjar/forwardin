import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const getUsers: RequestHandler = async (req, res) => {
    try {
        const users = await prisma.user.findMany({});
        res.status(200).json(users);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getUserProfile: RequestHandler = async (req, res) => {
    try {
        const userId = req.params.userId;

        const user = await prisma.user.findUnique({
            where: {
                id: userId,
            },
            select: {
                firstName: true,
                lastName: true,
                username: true,
                phone: true,
                email: true,
                accountApiKey: true,
                googleId: true,
                affiliationCode: true,
            },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json(user);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteUser: RequestHandler = async (req, res) => {
    try {
        const userId = req.params.userId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
        }

        const user = await prisma.user.findUnique({
            where: {
                id: userId,
            },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await prisma.user.delete({
            where: {
                id: userId,
            },
        });

        // soft delete
        // await prisma.user.update({
        //     where: {
        //         pkId: userId,
        //     },
        //     data: {
        //         deletedAt: new Date(),
        //     },
        // });

        return res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getUserSubscriptionDetail: RequestHandler = async (req, res) => {
    try {
        const userId = req.params.userId;

        const user = await prisma.user.findUnique({
            where: {
                id: userId,
            },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const subscription = await prisma.subscription.findFirst({
            where: { userId: user.pkId },
            include: { subscriptionPlan: { select: { name: true } } },
            orderBy: { startDate: 'desc' },
        });

        if (!subscription) {
            return res.status(404).json({ message: 'Subscription not found' });
        }
        res.status(200).json(subscription);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
