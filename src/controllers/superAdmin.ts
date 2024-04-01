import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateUuid } from '../utils/keyGenerator';

export const createUser: RequestHandler = async (req, res, next) => {
    try {
        const {
            firstName,
            lastName,
            email,
            phone,
            subscriptionPlanId,
            subscriptionPlanType,
            role = Number(process.env.ADMIN_ID),
        } = req.body;
        const transaction_time = new Date();

        if (
            !firstName ||
            !lastName ||
            !email ||
            !phone ||
            !subscriptionPlanId ||
            !subscriptionPlanType
        ) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{ email }, { phone }],
            },
        });
        if (existingUser) {
            return res
                .status(400)
                .json({ message: 'User with this username, email, or phone already exists' });
        }

        const existingPrivilege = await prisma.privilege.findUnique({
            where: { pkId: role },
        });
        if (!existingPrivilege) {
            return res.status(404).json({
                error: 'Privilege or role not found',
            });
        }

        const subscriptionPlan = await prisma.subscriptionPlan.findUnique({
            where: { id: subscriptionPlanId },
        });

        if (!subscriptionPlan) {
            return res.status(404).json({
                error: 'Subscription plan not found',
            });
        }

        const paidPrice =
            subscriptionPlanType === 'monthly'
                ? subscriptionPlan?.monthlyPrice
                : subscriptionPlan?.yearlyPrice;

        if (paidPrice === null || paidPrice === undefined) {
            return res.status(400).json({ error: 'Invalid subscriptionType' });
        }

        const order_id = `ORDER-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;

        const user = await prisma.user.create({
            data: {
                firstName,
                lastName,
                email,
                phone,
                accountApiKey: generateUuid(),
                privilege: {
                    connect: {
                        pkId: role,
                    },
                },
            },
        });

        await prisma.$transaction(async (transaction) => {
            await transaction.transaction.create({
                data: {
                    id: order_id,
                    status: 'paid',
                    paidPrice,
                    subscriptionPlanId: subscriptionPlan.pkId,
                    userId: user.pkId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            const transaction_time_iso = new Date(transaction_time).toISOString();
            const oneMonthLater = new Date(
                new Date(transaction_time).setMonth(new Date(transaction_time).getMonth() + 1),
            );
            const oneMonthLaterISO = oneMonthLater.toISOString();
            const oneYearLater = new Date(
                new Date(transaction_time).setFullYear(
                    new Date(transaction_time).getFullYear() + 1,
                ),
            );
            const oneYearLaterISO = oneYearLater.toISOString();

            await transaction.subscription.create({
                data: {
                    startDate: transaction_time_iso,
                    endDate: subscriptionPlanType === 'yearly' ? oneYearLaterISO : oneMonthLaterISO,
                    autoReplyMax: subscriptionPlan?.autoReplyQuota || 0,
                    deviceMax: subscriptionPlan?.deviceQuota || 0,
                    contactMax: subscriptionPlan?.contactQuota || 0,
                    broadcastMax: subscriptionPlan?.broadcastQuota || 0,
                    userId: user.pkId,
                    subscriptionPlanId: subscriptionPlan.pkId,
                },
            });
        });
        res.status(201).json({
            message: 'User created successfully',
        });
    } catch (error) {
        logger.error(error);
        next(error);
    }
};

export const getUsers: RequestHandler = async (req, res, next) => {
    try {
        const users = await prisma.user.findMany({
            select: {
                pkId: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                googleId: true,
                createdAt: true,
                Subscription: {
                    select: {
                        subscriptionPlan: {
                            select: {
                                name: true,
                            },
                        },
                    },
                },
            },
        });
        res.status(200).json(users);
    } catch (error) {
        logger.error(error);
        next(error);
    }
};
export const getTransactions: RequestHandler = async (req, res, next) => {
    try {
        const transaction = await prisma.transaction.findMany({
            select: {
                pkId: true,
                id: true,
                status: true,
                createdAt: true,
                paidPrice: true,
                subscriptionPlan: {
                    select: {
                        name: true,
                    },
                },
                user: {
                    select: {
                        email: true,
                        firstName: true,
                        lastName: true,
                        phone: true,
                        googleId: true,
                    },
                },
            },
        });
        res.status(200).json(transaction);
    } catch (error) {
        logger.error(error);
        next(error);
    }
};

export const updateStatusTransaction: RequestHandler = async (req, res, next) => {
    try {
        const id = req.params.transactionId;
        const { status } = req.body;

        const transaction_time = new Date();

        const existingTransaction = await prisma.transaction.findUnique({
            where: { id },
            include: {
                user: true,
                subscriptionPlan: true,
            },
        });

        if (!existingTransaction) {
            return res.status(404).json({ message: 'Transaction not found' });
        }

        const transaction_time_iso = new Date(transaction_time).toISOString();
        const oneMonthLater = new Date(
            new Date(transaction_time).setMonth(new Date(transaction_time).getMonth() + 1),
        );
        const oneMonthLaterISO = oneMonthLater.toISOString();
        const oneYearLater = new Date(
            new Date(transaction_time).setFullYear(new Date(transaction_time).getFullYear() + 1),
        );
        const oneYearLaterISO = oneYearLater.toISOString();

        const transaction = await prisma.transaction.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        });

        if (transaction.status == 'paid') {
            await prisma.$transaction(async (transaction) => {
                await transaction.subscription.create({
                    data: {
                        startDate: transaction_time_iso,
                        endDate:
                            existingTransaction.paidPrice ==
                            existingTransaction.subscriptionPlan.yearlyPrice
                                ? oneYearLaterISO
                                : oneMonthLaterISO,
                        autoReplyMax: existingTransaction.subscriptionPlan.autoReplyQuota || 0,
                        deviceMax: existingTransaction.subscriptionPlan.deviceQuota || 0,
                        contactMax: existingTransaction.subscriptionPlan.contactQuota || 0,
                        broadcastMax: existingTransaction.subscriptionPlan.broadcastQuota || 0,
                        userId: existingTransaction.user.pkId,
                        subscriptionPlanId: existingTransaction.subscriptionPlan.pkId,
                    },
                });
            });
            return res.status(200).json({ message: 'Subscription created successfully' });
        }
        return res.status(200).json({ message: 'Transaction status updated successfully' });
    } catch (error) {
        logger.error(error);
        next(error);
    }
};
