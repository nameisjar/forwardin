import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

// export const createUser: RequestHandler = async (req, res, next) => {
//     try {
//         const { firstName, lastName, email, phone, googleId, subscriptionId } = req.body;
//         const user = await prisma.user.create({
//             data: {
//                 firstName,
//                 lastName,
//                 email,
//                 phone,
//                 googleId,
//                 username: '', // Add the missing property 'username'
//                 password: '', // Add the missing property 'password'
//                 affiliationCode: '', // Add the missing property 'affiliationCode'
//                 Subscription: {
//                     connect: {
//                         pkId: subscriptionId,
//                     },
//                 },
//             },
//         });
//         res.status(201).json(user);
//     } catch (error) {
//         logger.error(error);
//         next(error);
//     }
// }

// export const getUsers: RequestHandler = async (req, res, next) => {
//     try {
//         const users = await prisma.user.findMany({
//             select: {
//                 pkId: true,
//                 firstName: true,
//                 lastName: true,
//                 email: true,
//                 phone: true,
//                 googleId: true,
//                 createdAt: true,
//                 Subscription: {
//                     select: {
//                         subscriptionPlan: {
//                             select: {
//                                 name: true
//                             },

//                         },
//                     },
//                 },
//             },
//         });
//         res.status(200).json(users);
//     } catch (error) {
//         logger.error(error);
//         next(error);
//     }
// }
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
        const { status, transaction_time } = req.body;

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
