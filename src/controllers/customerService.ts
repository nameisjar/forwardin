import { RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateAccessToken, generateRefreshToken } from '../utils/jwtGenerator';

export const registerCS: RequestHandler = async (req, res) => {
    try {
        const { username, email, password, userId, deviceId, confirmPassword } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        const existingCS = await prisma.customerService.findFirst({
            where: {
                OR: [{ email }, { username }],
            },
        });
        if (existingCS) {
            return res
                .status(400)
                .json({ message: 'CS with this email or username already exists' });
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

        const newCS = await prisma.customerService.create({
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
            message: 'CS created successfully',
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

export const login: RequestHandler = async (req, res) => {
    try {
        const { identifier, password } = req.body;

        const cs = await prisma.customerService.findFirst({
            where: {
                OR: [{ email: identifier }, { username: identifier }],
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
        const refreshToken = cs.refreshToken;
        const id = cs.id;

        return res.status(200).json({ accessToken, refreshToken, id, role: cs.privilegeId });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
