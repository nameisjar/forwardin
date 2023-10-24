/* eslint-disable @typescript-eslint/no-explicit-any */
import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const getUserProfile: RequestHandler = async (req, res) => {
    try {
        const userId = req.prismaUser.pkId;
        logger.warn(userId);

        const user = await prisma.user.findUnique({
            where: {
                pkId: userId,
            },
            select: {
                firstName: true,
                lastName: true,
                username: true,
                phone: true,
                email: true,
                accountApiKey: true,
                affiliationCode: true,
            },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        return res.status(200).json(user);
    } catch (error) {
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteUser: RequestHandler = async (req, res) => {
    try {
        const userId = req.prismaUser.pkId;

        if (!userId) {
            return res.status(401).json({ message: 'Unauthorized: User not authenticated' });
        }

        const user = await prisma.user.findUnique({
            where: {
                pkId: userId,
            },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        await prisma.user.delete({
            where: {
                pkId: userId,
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
        console.error('Error deleting user:', error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getUserSubscriptionQuota: RequestHandler = async (req, res) => {
    try {
        const { userId } = req.params;

        const user = await prisma.user.findUnique({
            where: { id: userId },
            select: {
                AutoReplyQuota: { select: { max: true, used: true } },
                BroadcastQuota: { select: { max: true, used: true } },
                ContactQuota: { select: { max: true, used: true } },
                DeviceQuota: { select: { max: true, used: true } },
            },
        });

        res.status(200).json(user);
    } catch (error: any) {
        logger.error(error.message);
        res.status(500).json({ message: 'Internal server error' });
    }
};
