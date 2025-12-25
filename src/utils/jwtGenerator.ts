import jwt from 'jsonwebtoken';
import 'dotenv/config';
import { accessTokenPayload, refreshTokenPayload } from '../types';

// Validate JWT secret at startup
if (!process.env.JWT_SECRET_KEY) {
    throw new Error('CRITICAL: JWT_SECRET_KEY environment variable is not set. Server cannot start securely.');
}

export const jwtSecretKey = process.env.JWT_SECRET_KEY;

export type DeviceAccessTokenPayload = {
    deviceId: string;
    userId: number;
    purpose: 'device-api';
};

export function generateDeviceAccessToken(payload: DeviceAccessTokenPayload): string {
    // short-lived token to authorize /api calls in addition to X-Forwardin-Key-Device
    return jwt.sign(payload, jwtSecretKey, { expiresIn: process.env.DEVICE_ACCESS_TOKEN_TTL || '2m' });
}

export function verifyDeviceAccessToken(token: string): DeviceAccessTokenPayload {
    return jwt.verify(token, jwtSecretKey) as DeviceAccessTokenPayload;
}

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
