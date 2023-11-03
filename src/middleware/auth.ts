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
        req.prismaUser = user as User;
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

    req.prismaUser = user;
    req.apiKey = apiKey;
    next();
};

// to protect super admin routes
export const superAdminOnly: RequestHandler = async (req, res, next) => {
    const user = req.prismaUser;

    const privilege = await prisma.user.findUnique({
        where: { id: user.id },
        select: { privilege: { select: { name: true } } },
    });

    if (user && privilege?.privilege?.name === 'super admin') {
        next();
    } else {
        res.status(403).json({ message: 'Access denied: Super admin only' });
    }
};

// to protect controllers based on user privilege roles
// eg: users with non-super admin privilege can't perform user deletion
export function checkPrivilege(controller: string): RequestHandler {
    return async (req, res, next) => {
        const method = req.method.toLowerCase();

        const user = await prisma.user.findUnique({
            where: { pkId: req.prismaUser.pkId },
            select: { privilege: { select: { roles: { include: { module: true } } } } },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const userRoles = user.privilege?.roles;

        if (!userRoles) {
            return res
                .status(403)
                .json({ message: "Access denied. You haven't been assigned to any roles" });
        }

        const hasRequiredPrivilege = userRoles.some((role) => {
            if (method === 'post' && role.isCreate) {
                return role.module.controller === controller;
            }
            if (method === 'get' && role.isRead) {
                return role.module.controller === controller;
            }
            if (method === 'put' && role.isEdit) {
                return role.module.controller === controller;
            }
            if (method === 'delete' && role.isDelete) {
                return role.module.controller === controller;
            }
            return false;
        });

        if (hasRequiredPrivilege) {
            next();
        } else {
            res.status(403).json({
                message:
                    'Access denied. You do not have the required privileges to perform this action',
            });
        }
    };
}

export default authMiddleware;

export const isEmailVerified: RequestHandler = async (req, res, next) => {
    const user = req.prismaUser;

    if (user && user.emailVerifiedAt) {
        next();
    } else {
        res.status(403).json({ message: 'Email not verified yet' });
    }
};
