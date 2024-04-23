import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { accessTokenPayload, refreshTokenPayload } from '../types';

export const jwtSecretKey = process.env.JWT_SECRET_KEY!;

export function generateAccessToken(user: accessTokenPayload): string {
    const payload = {
        email: user.email,
    };

    return jwt.sign(payload, jwtSecretKey, { expiresIn: '1h' });
}

export function generateRefreshToken(user: refreshTokenPayload): string {
    const payload = {
        id: user.id,
    };

    return jwt.sign(payload, jwtSecretKey, { expiresIn: '7d' });
}
