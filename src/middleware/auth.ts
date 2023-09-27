import { User } from '@prisma/client';
import { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import prisma from '../utils/db';
import { jwtSecretKey } from '../utils/jwtGenerator';

export const authMiddleware: RequestHandler = (req, res, next) => {
    if (!req.header('Authorization')) {
        apiKey(req, res, next);
    } else {
        accessToken(req, res, next);
    }
};

export const accessToken: RequestHandler = (req, res, next) => {
    const authHeader = req.header('Authorization');

    if (!authHeader || !authHeader.startsWith('Bearer ')) {
        return res.status(401).json({ message: 'Authentication failed: Missing or invalid token' });
    }

    const token = authHeader.substring('Bearer '.length);

    if (!token) {
        return res.status(401).json({ error: 'Authentication failed: Invalid token' });
    }

    jwt.verify(token, jwtSecretKey, (err, user) => {
        if (err) {
            return res.status(403).json({ message: 'Access denied: Invalid token' });
        }
        req.user = user as User;
        next();
    });
};

export const apiKey: RequestHandler = async (req, res, next) => {
    const apiKey = req.header('X-Forwardin-Key');

    if (!apiKey) {
        return res.status(401).json({ message: 'Authentication failed: Missing API key' });
    }
    const user = await prisma.user.findUnique({
        where: {
            accountApiKey: apiKey,
        },
    });

    if (!user) {
        return res.status(401).json({ message: 'Access denied: Invalid API key' });
    }

    req.user = user;
    req.apiKey = apiKey;
    next();
};

export const isSuperAdmin: RequestHandler = async (req, res, next) => {
    const user = req.user;

    if (user && user.privilegeId === 1) {
        next();
    } else {
        res.status(403).json({ message: 'Access denied: Not a super admin' });
    }
};

export default authMiddleware;

export const isEmailVerified: RequestHandler = async (req, res, next) => {
    const user = req.user;

    if (user && user.emailVerifiedAt) {
        next();
    } else {
        res.status(403).json({ message: 'Email not verified yet' });
    }
};
