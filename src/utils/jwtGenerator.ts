import { User } from '@prisma/client';
import jwt, { JsonWebTokenError } from 'jsonwebtoken';
import { DecodedToken } from '../types';

const jwtSecretKey = process.env.JWT_SECRET_KEY!;

export function generateAccessToken(user: User) {
    const payload = {
        userId: user.pkId,
        username: user.username,
        email: user.email,
    };

    return jwt.sign(payload, jwtSecretKey, { expiresIn: '15m' });
}

export function generateRefreshToken(user: User) {
    const payload = {
        userId: user.pkId,
    };

    const refreshToken = jwt.sign(payload, jwtSecretKey, { expiresIn: '7d' });

    return refreshToken;
}

export const decodeJwtToken = (token: string, jwtSecretKey: string): DecodedToken | null => {
    try {
        const decodedToken = jwt.verify(token, jwtSecretKey) as DecodedToken;
        return decodedToken;
    } catch (error) {
        if (error instanceof JsonWebTokenError) {
            return null;
        }
        throw error;
    }
};

export const extractUserIdAndEmailFromToken = (
    token: string,
    jwtSecretKey: string,
): { userId: number; email: string } | null => {
    const decodedToken = decodeJwtToken(token, jwtSecretKey);
    if (decodedToken && decodedToken.userId && decodedToken.email) {
        return { userId: decodedToken.userId, email: decodedToken.email };
    }
    return null;
};
