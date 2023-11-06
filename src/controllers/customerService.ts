import { RequestHandler } from 'express';
import bcrypt from 'bcrypt';
import prisma from '../utils/db';
import logger from '../config/logger';

export const registerCS: RequestHandler = async (req, res) => {
    try {
        const { email, password, userId, deviceId, confirmPassword } = req.body;
        const hashedPassword = await bcrypt.hash(password, 10);
        if (password !== confirmPassword) {
            return res.status(400).json({ message: 'Passwords do not match' });
        }

        const existingCS = await prisma.customerService.findUnique({
            where: { email },
        });
        if (existingCS) {
            return res.status(400).json({ message: 'CS with this email already exists' });
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
                error: 'User not found',
            });
        }

        const newCS = await prisma.customerService.create({
            data: {
                email,
                password: hashedPassword,
                // accountApiKey: generateUuid(),
                privilegeId: privilege.pkId,
                userId: user.pkId,
                deviceId: device.pkId,
            },
        });

        // const accessToken = generateAccessToken(newUser);
        // const refreshToken = generateRefreshToken(newUser);
        // const accountApiKey = newUser.accountApiKey;
        // const id = newCS.id;

        // await prisma.user.update({
        //     where: { pkId: newUser.pkId },
        //     data: { refreshToken },
        // });
        res.status(201).json({ message: 'CS created successfully', data: newCS });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
