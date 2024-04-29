import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateUuid } from '../utils/keyGenerator';
import { generatePassword, sendEmail } from '../utils/otpHelper';
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '../utils/jwtGenerator';
import { passwordTemplate } from '../utils/templateEmailPassword';

export const addSuperAdmin: RequestHandler = async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            username,
            phone,
            email,
            role = Number(process.env.SUPER_ADMIN_ID),
        } = req.body;

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{ username }, { email }, { phone }],
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
        const newUser = await prisma.user.create({
            data: {
                username,
                firstName,
                lastName,
                phone,
                email,
                accountApiKey: generateUuid(),
                affiliationCode: username,
                privilege: { connect: { pkId: role } },
            },
        });

        await prisma.$transaction(async (transaction) => {
            const password = generatePassword();
            const passwordHash = await bcrypt.hash(password, 10);
            const refreshToken = generateRefreshToken(newUser);
            await transaction.user.update({
                where: { pkId: newUser.pkId },
                data: {
                    password: passwordHash,
                    refreshToken,
                    emailVerifiedAt: new Date(),
                },
            });
            const template = passwordTemplate(password, 'Admin' + '' + newUser.firstName);
            await sendEmail(
                email,
                template,
                'Your password for login to the Forwardin App as Super Admin',
            );
        });

        res.status(201).json({
            message: 'SuperAdmin account created successfully with password sent to email',
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSuperAdmins: RequestHandler = async (req, res) => {
    try {
        const { page = 1, pageSize = 10 } = req.query;
        const offset = (Number(page) - 1) * Number(pageSize);

        const superAdmins = await prisma.user.findMany({
            take: Number(pageSize),
            skip: offset,
            where: {
                privilegeId: Number(process.env.SUPER_ADMIN_ID),
                deletedAt: null,
            },
            select: {
                pkId: true,
                firstName: true,
                lastName: true,
                email: true,
                phone: true,
                createdAt: true,
            },
            orderBy: {
                createdAt: 'desc',
            },
        });
        res.status(200).json(superAdmins);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const login: RequestHandler = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        const user = await prisma.user.findFirst({
            where: {
                OR: [
                    { email: identifier, deletedAt: null },
                    { phone: identifier, deletedAt: null },
                    { username: identifier, deletedAt: null },
                    { googleId: identifier, deletedAt: null },
                ],
            },
        });

        if (!user) {
            return res.status(401).json({ message: 'Account not found or has been deleted' });
        }

        if (user.privilegeId !== Number(process.env.SUPER_ADMIN_ID)) {
            return res.status(401).json({ message: 'Account not authorized' });
        }

        const passwordMatch = await bcrypt.compare(password, user.password || '');
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Email or Password is incorrect' });
        }

        const accessToken = generateAccessToken(user);
        // const refreshToken = user.refreshToken;
        const refreshToken = generateRefreshToken(user);
        const id = user.id;

        await prisma.user.update({
            where: { pkId: user.pkId },
            data: { refreshToken },
        });

        return res.status(200).json({ accessToken, refreshToken, id, role: user.privilegeId });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createUserAdmin: RequestHandler = async (req, res) => {
    try {
        const {
            firstName,
            lastName,
            username,
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
            !username ||
            !email ||
            !phone ||
            !subscriptionPlanId ||
            !subscriptionPlanType
        ) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{ username }, { email }, { phone }],
            },
        });

        if (existingUser) {
            return res
                .status(400)
                .json({ message: 'User with this username, email or phone already exists' });
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

        const newUser = await prisma.user.create({
            data: {
                firstName,
                lastName,
                username,
                email,
                phone,
                accountApiKey: generateUuid(),
                affiliationCode: firstName,
                privilege: {
                    connect: {
                        pkId: role,
                    },
                },
            },
        });

        await prisma.$transaction(async (transaction) => {
            // Create transaction
            await transaction.transaction.create({
                data: {
                    id: order_id,
                    status: 'paid',
                    paidPrice,
                    subscriptionPlanId: subscriptionPlan.pkId,
                    userId: newUser.pkId,
                    createdAt: new Date(),
                    updatedAt: new Date(),
                },
            });

            // Generate password and send email to user
            const password = generatePassword();
            const passwordHash = await bcrypt.hash(password, 10);
            const refreshToken = generateRefreshToken(newUser);
            await transaction.user.update({
                where: { pkId: newUser.pkId },
                data: {
                    password: passwordHash,
                    updatedAt: new Date(),
                    refreshToken,
                    emailVerifiedAt: new Date(),
                },
            });
            const template = passwordTemplate(password, newUser.firstName + ' ' + newUser.lastName);
            await sendEmail(email, template, 'Your password for login to the Forwardin App');

            // Create subscription
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
                    userId: newUser.pkId,
                    subscriptionPlanId: subscriptionPlan.pkId,
                },
            });
        });
        res.status(201).json({
            message: 'User created successfully with password sent to email',
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getUsers: RequestHandler = async (req, res) => {
    try {
        const users = await prisma.user.findMany({
            where: {
                deletedAt: null,
                NOT: { privilegeId: Number(process.env.SUPER_ADMIN_ID) },
            },
            select: {
                pkId: true,
                id: true,
                firstName: true,
                lastName: true,
                username: true,
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
                transactions: {
                    select: {
                        id: true,
                        status: true,
                        paidPrice: true,
                        subscriptionPlan: {
                            select: {
                                name: true,
                            },
                        },
                    },
                    orderBy: {
                        createdAt: 'desc',
                    },
                },
            },
        });
        res.status(200).json(users);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
export const getTransactions: RequestHandler = async (req, res) => {
    try {
        const transaction = await prisma.transaction.findMany({
            where: {
                status: 'unpaid',
            },
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
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateUser: RequestHandler = async (req, res) => {
    try {
        const id = req.params.userId;
        const {
            firstName,
            lastName,
            username,
            email,
            phone,
            role = Number(process.env.ADMIN_ID),
        } = req.body;
        if (!firstName || !lastName || !email || !phone) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const existingUser = await prisma.user.findFirst({
            where: {
                OR: [{ username }, { email }, { phone }],
                NOT: { id: id },
            },
        });

        if (existingUser) {
            return res
                .status(400)
                .json({ message: 'User with this username, email or phone already exists' });
        }

        const existingPrivilege = await prisma.privilege.findUnique({
            where: { pkId: role },
        });
        if (!existingPrivilege) {
            return res.status(404).json({
                error: 'Privilege or role not found',
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: id },
        });
        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const updateUser = await prisma.user.update({
            where: { id },
            data: {
                firstName,
                lastName,
                username,
                email,
                phone,
                accountApiKey: generateUuid(),
                affiliationCode: firstName,
                privilege: {
                    connect: {
                        pkId: role,
                    },
                },
            },
        });

        await prisma.$transaction(async (transaction) => {
            // Generate password and send email to user
            const password = generatePassword();
            const passwordHash = await bcrypt.hash(password, 10);
            const refreshToken = generateRefreshToken(updateUser);
            await transaction.user.update({
                where: { pkId: updateUser.pkId },
                data: {
                    password: passwordHash,
                    updatedAt: new Date(),
                    refreshToken,
                    emailVerifiedAt: new Date(),
                },
            });

            if (email !== user.email) {
                const template = passwordTemplate(
                    password,
                    updateUser.firstName + ' ' + updateUser.lastName,
                );
                await sendEmail(
                    email,
                    template,
                    'Your new password for login to the Forwardin App',
                );
            }
        });

        res.status(200).json({ message: 'User updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateSubscription: RequestHandler = async (req, res) => {
    try {
        const id = req.params.userId;
        const { subscriptionPlanId, subscriptionPlanType } = req.body;

        const transaction_time = new Date();

        const user = await prisma.user.findUnique({
            where: { id },
            include: {
                Subscription: true,
            },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
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

        await prisma.$transaction(async (transaction) => {
            //delete subscription
            await transaction.subscription.deleteMany({
                where: {
                    userId: user.pkId,
                },
            });
            // Create transaction
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

            // Create subscription
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
        res.status(200).json({ message: 'Subscription updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateStatusTransaction: RequestHandler = async (req, res) => {
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

        const existingSubscription = await prisma.subscription.findFirst({
            where: { userId: existingTransaction.user.pkId },
        });

        //delete subscription
        if (existingSubscription) {
            await prisma.subscription.deleteMany({
                where: {
                    userId: existingTransaction.user.pkId,
                },
            });
        }

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
                await transaction.notification.create({
                    data: {
                        title: 'Paymen Success',
                        body: `Your subscription has been created successfully with ${existingTransaction.subscriptionPlan.name} plan for date ${transaction_time_iso} to ${oneYearLaterISO}`,
                        userId: existingTransaction.user.pkId,
                    },
                });
            });
            return res.status(200).json({ message: 'Subscription created successfully' });
        }

        await prisma.notification.create({
            data: {
                title: 'Subscription Disabled',
                body: `Your subscription has been disabled with ${existingTransaction.subscriptionPlan.name} plan for date ${transaction_time_iso} to ${oneYearLaterISO}`,
                userId: existingTransaction.user.pkId,
            },
        });

        return res.status(200).json({ message: 'Transaction status updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteUserById: RequestHandler = async (req, res) => {
    try {
        const userId = req.params.userId;

        if (!userId) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        const user = await prisma.user.findUnique({
            where: {
                id: userId,
                deletedAt: null,
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

export const deleteUsers: RequestHandler = async (req, res) => {
    try {
        const userIds = req.body.userIds;

        if (!userIds) {
            return res.status(400).json({ message: 'Missing required fields' });
        }

        await prisma.$transaction(async (transaction) => {
            for (let i = 0; i < userIds.length; i++) {
                const user = await prisma.user.findUnique({
                    where: {
                        id: userIds[i],
                    },
                });

                if (!user) {
                    return res.status(404).json({ message: 'User not found' });
                }

                // soft delete
                await transaction.user.update({
                    where: {
                        id: userIds[i],
                    },
                    data: {
                        // make acc api key null so user can't access via api
                        accountApiKey: null,
                        deletedAt: new Date(),
                    },
                });
            }
        });

        return res.status(200).json({ message: 'Users deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
