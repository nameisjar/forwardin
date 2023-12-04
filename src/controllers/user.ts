import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import { isUUID } from '../utils/uuidChecker';

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

        if (!isUUID(userId)) {
            return res.status(400).json({ message: 'Invalid userId' });
        }

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
                emailVerifiedAt: true,
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

export const updateUser: RequestHandler = async (req, res) => {
    const { firstName, lastName, username, affiliationCode } = req.body;
    const userId = req.params.userId;

    if (!isUUID(userId)) {
        return res.status(400).json({ message: 'Invalid userId' });
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            username,
            NOT: { id: userId },
        },
    });
    if (existingUser) {
        return res.status(400).json({ message: 'User with this username already exists' });
    }

    const existingAffiliationCode = await prisma.user.findUnique({
        where: { affiliationCode, NOT: { id: userId } },
    });

    if (existingAffiliationCode) {
        return res.status(400).json({ message: 'Affiliation code is already used' });
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        return res.status(404).json({ message: 'User to update not found' });
    }

    await prisma.user.update({
        where: {
            id: userId,
        },
        data: {
            firstName,
            lastName,
            username,
            affiliationCode,
            updatedAt: new Date(),
        },
    });

    return res.status(200).json({ message: 'User profile updated successfully' });
};

export const changeEmail: RequestHandler = async (req, res) => {
    const { email } = req.body;
    const userId = req.params.userId;

    if (!isUUID(userId)) {
        return res.status(400).json({ message: 'Invalid userId' });
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            email,
            NOT: { id: userId },
        },
    });
    if (existingUser) {
        return res.status(400).json({ message: 'User with this email already exists' });
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        return res.status(404).json({ message: 'User to update not found' });
    }

    await prisma.user.update({
        where: {
            id: userId,
        },
        data: {
            email,
            emailOtpSecret: email && email == user.email ? user.emailOtpSecret : null,
            emailVerifiedAt: email && email == user.email ? user.emailVerifiedAt : null,
            updatedAt: new Date(),
        },
    });

    return res.status(200).json({ message: 'Email changed successfully' });
};

export const changePhoneNumber: RequestHandler = async (req, res) => {
    const { phoneNumber } = req.body;
    const userId = req.params.userId;

    if (!isUUID(userId)) {
        return res.status(400).json({ message: 'Invalid userId' });
    }

    const existingUser = await prisma.user.findUnique({
        where: {
            phone: phoneNumber,
            NOT: { id: userId },
        },
    });
    if (existingUser) {
        return res.status(400).json({ message: 'User with this phone already exists' });
    }

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        return res.status(404).json({ message: 'User to update not found' });
    }

    await prisma.user.update({
        where: {
            id: userId,
        },
        data: {
            phone: phoneNumber,
            // emailOtpSecret: email && email == user.email ? user.emailOtpSecret : null,
            // emailVerifiedAt: email && email == user.email ? user.emailVerifiedAt : null,
            updatedAt: new Date(),
        },
    });

    return res.status(200).json({ message: 'Phone number changed successfully' });
};

export const getCustomerServices: RequestHandler = async (req, res) => {
    try {
        const userId = req.params.userId;
        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!isUUID(userId)) {
            return res.status(400).json({ message: 'Invalid userId' });
        }

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const customerServices = await prisma.customerService.findMany({
            where: { userId: user.pkId },
            include: { device: { select: { id: true } } },
        });
        return res.status(200).json(customerServices);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: delete user > delete device > logout session! > delete contact? > delete group > delete cs > delete subscription > delete transaction
export const deleteUser: RequestHandler = async (req, res) => {
    try {
        const userId = req.params.userId;

        if (!isUUID(userId)) {
            return res.status(400).json({ message: 'Invalid userId' });
        }

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

        // await prisma.user.delete({
        //     where: {
        //         id: userId,
        //     },
        // });

        // soft delete
        await prisma.user.update({
            where: {
                id: userId,
            },
            data: {
                // make acc api key null so user can't access via api
                accountApiKey: null,
                deletedAt: new Date(),
            },
        });

        return res.status(200).json({ message: 'User deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getUserSubscriptionDetail: RequestHandler = async (req, res) => {
    try {
        const userId = req.params.userId;

        if (!isUUID(userId)) {
            return res.status(400).json({ message: 'Invalid userId' });
        }

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
