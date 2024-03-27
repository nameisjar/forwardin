import { RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateAccessToken, generateRefreshToken } from '../utils/jwtGenerator';
import { isUUID } from '../utils/uuidChecker';

export const registerCS: RequestHandler = async (req, res) => {
    try {
        const { username, email, password, userId, deviceId, confirmPassword } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        const existingCS = await prisma.customerService.findFirst({
            where: {
                OR: [{ email }, { username }, { device: { id: deviceId } }],
            },
        });
        if (existingCS) {
            return res
                .status(400)
                .json({ message: 'CS with this email, username, or deviceId already exists' });
        }

        const privilege = await prisma.privilege.findUnique({
            where: { pkId: Number(process.env.CS_ID) },
        });
        if (!privilege) {
            return res.status(404).json({
                message: 'Privilege not found',
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            return res.status(404).json({
                message: 'User not found',
            });
        }

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
        });
        if (!device) {
            return res.status(404).json({
                message: 'Device not found',
            });
        }

        const newCS = await prisma.customerService.create({
            data: {
                username,
                email,
                password: hashedPassword,
                privilegeId: privilege.pkId,
                userId: user.pkId,
                deviceId: device.pkId,
            },
            include: {
                device: { select: { id: true, sessions: { select: { sessionId: true } } } },
            },
        });

        const accessToken = generateAccessToken(newCS);
        const refreshToken = generateRefreshToken(newCS);
        const id = newCS.id;

        await prisma.customerService.update({
            where: { pkId: newCS.pkId },
            data: { refreshToken },
        });
        res.status(201).json({
            message: 'CS created successfully',
            accessToken,
            refreshToken,
            id,
            role: newCS.privilegeId,
            sessionId: newCS.device?.sessions[0]?.sessionId,
            deviceId: newCS.device?.id,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const login: RequestHandler = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        const cs = await prisma.customerService.findFirst({
            where: {
                OR: [{ email: identifier }, { username: identifier }],
            },
            include: {
                device: { select: { id: true, sessions: { select: { sessionId: true } } } },
            },
        });

        if (!cs) {
            return res.status(404).json({ message: 'CS Account not found' });
        }

        const passwordMatch = await bcrypt.compare(password, cs.password);
        if (!passwordMatch) {
            return res.status(401).json({ message: 'Wrong password' });
        }

        const accessToken = generateAccessToken(cs);
        const refreshToken = generateRefreshToken(cs);
        const id = cs.id;

        await prisma.customerService.update({
            where: { pkId: cs.pkId },
            data: { refreshToken },
        });

        return res.status(200).json({
            accessToken,
            refreshToken,
            id,
            role: cs.privilegeId,
            sessionId: cs.device?.sessions[0]?.sessionId,
            deviceId: cs.device?.id,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getCustomerService: RequestHandler = async (req, res) => {
    try {
        const csId = req.params.csId;
        const cs = await prisma.customerService.findUnique({
            where: { id: csId },
            include: {
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        devices: { select: { sessions: { select: { sessionId: true }, take: 1 } } },
                    },
                },
            },
        });

        if (!isUUID(csId)) {
            return res.status(400).json({ message: 'Invalid userId' });
        }

        if (!cs) {
            return res.status(404).json({ message: 'CS not found' });
        }

        return res.status(200).json(cs);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateCS: RequestHandler = async (req, res) => {
    try {
        const { username, email, password, userId, deviceId, confirmPassword } = req.body;
        const csId = req.params.csId;

        if (!isUUID(csId)) {
            return res.status(400).json({ message: 'Invalid csId' });
        }

        const hashedPassword = await bcrypt.hash(password, 10);
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }
        const CS = await prisma.customerService.findUnique({
            where: {
                id: csId,
            },
        });

        if (!CS) {
            return res.status(400).json({ message: 'CS not found' });
        }

        const privilege = await prisma.privilege.findUnique({
            where: { pkId: Number(process.env.CS_ID) },
        });
        if (!privilege) {
            return res.status(404).json({
                error: 'Privilege not found',
            });
        }

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });
        if (!user) {
            return res.status(404).json({
                error: 'User not found',
            });
        }

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
        });
        if (!device) {
            return res.status(404).json({
                error: 'Device not found',
            });
        }

        const newCS = await prisma.customerService.update({
            where: { pkId: CS.pkId },
            data: {
                username,
                email,
                password: hashedPassword,
                privilegeId: privilege.pkId,
                userId: user.pkId,
                deviceId: device.pkId,
            },
        });

        const accessToken = generateAccessToken(newCS);
        const refreshToken = generateRefreshToken(newCS);
        const id = newCS.id;

        await prisma.customerService.update({
            where: { pkId: newCS.pkId },
            data: { refreshToken },
        });
        res.status(201).json({
            message: 'CS updated successfully',
            accessToken,
            refreshToken,
            id,
            role: newCS.privilegeId,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteCS: RequestHandler = async (req, res) => {
    const csIds = req.body.csIds;

    try {
        const csPromises = csIds.map(async (csId: string) => {
            await prisma.customerService.delete({
                where: { id: csId },
            });
        });

        // wait for all the Promises to settle (either resolve or reject)
        await Promise.all(csPromises);

        res.status(200).json({ message: 'Customer service(s) deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
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
                updatedAt: true,
                paidPrice: true,
                subscriptionPlan: {
                    select: {
                        name: true,
                    },
                },
                user: {
                    select: {
                        email: true,
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

export const updateTransaction: RequestHandler = async (req, res, next) => {
    try {
        const id = req.params.transactionId;
        const { status } = req.body;

        const updatedTransaction = await prisma.transaction.update({
            where: { id },
            data: {
                status,
                updatedAt: new Date(),
            },
        });

        res.status(200).json({
            message: 'Transaction updated successfully',
            data: updatedTransaction,
        });
    } catch (error) {
        logger.error(error);
        next(error);
    }
};
