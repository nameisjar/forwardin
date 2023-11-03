import jwt from 'jsonwebtoken';
import { User } from '@prisma/client';
import 'dotenv/config';
import { userPayload } from '../types';

export const jwtSecretKey = process.env.JWT_SECRET_KEY!;

export function generateAccessToken(user: userPayload): string {
    const payload = {
        pkId: user.pkId,
        id: user.id,
        username: user.username,
        email: user.email,
        phone: user.phone,
        firstName: user.firstName,
        lastName: user.lastName,
        privilege: user.privilege,
    };

    return jwt.sign(payload, jwtSecretKey, { expiresIn: '15m' });
}

export function generateRefreshToken(user: User): string {
    const payload = {
        pkId: user.pkId,
    };

    return jwt.sign(payload, jwtSecretKey, { expiresIn: '7d' });
}
