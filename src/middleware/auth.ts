import { User } from '@prisma/client';
import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/db';
import { jwtSecretKey } from '../utils/jwtGenerator';

export const authenticateUser: RequestHandler = (req, res, next) => {
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

export const apiKey: RequestHandler = async (req, res, next) => {
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
