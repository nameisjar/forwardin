import { PrismaClient, User } from '@prisma/client';
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const jwtSecretKey = process.env.JWT_SECRET_KEY!;
const prisma = new PrismaClient();

export const authenticateUser = (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication failed: Missing or invalid token' });
    }

    const token = authHeader.substring('Bearer '.length);

    jwt.verify(token, jwtSecretKey, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Access denied: Invalid token' });
        }
        req.user = user as User;
        next();
    });
};

export const apiKey = async (req: Request, res: Response, next: NextFunction) => {
    const token = req.header('x-forwardin-key');

    if (!token) {
        return res.status(401).json({ message: 'Authentication failed: Missing API key' });
    }
    const user = await prisma.user.findFirst({
        where: {
            accountApiKey: token,
        },
    });

    if (token !== user?.accountApiKey) {
        return res.status(401).json({ message: 'Access denied: Invalid API key' });
    }

    req.apiKey = token;
    next();
};
