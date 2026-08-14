import { createHmac, timingSafeEqual } from 'crypto';
import { jwtSecretKey } from './jwtGenerator';

const signatureFor = (deviceId: string, messageId: string) =>
    createHmac('sha256', jwtSecretKey)
        .update(`${deviceId}:${messageId}`)
        .digest('hex');

const PROFILE_URL_TTL_SECONDS = 60 * 60;

const profileSignatureFor = (deviceId: string, jid: string, expires: number) =>
    createHmac('sha256', jwtSecretKey)
        .update(`profile:${deviceId}:${jid}:${expires}`)
        .digest('hex');

export function createInboxMediaUrl(deviceId: string, messageId: string): string {
    const token = signatureFor(deviceId, messageId);
    return `/inbox-media/${encodeURIComponent(deviceId)}/${encodeURIComponent(messageId)}?token=${token}`;
}

export function verifyInboxMediaToken(
    deviceId: string,
    messageId: string,
    token: string,
): boolean {
    const expected = Buffer.from(signatureFor(deviceId, messageId), 'hex');
    let provided: Buffer;
    try {
        provided = Buffer.from(token, 'hex');
    } catch {
        return false;
    }
    return provided.length === expected.length && timingSafeEqual(provided, expected);
}

export function serializeInboxMediaPath(
    mediaPath: string | null | undefined,
    deviceId: string,
    messageId: string,
): string | null | undefined {
    return mediaPath ? createInboxMediaUrl(deviceId, messageId) : mediaPath;
}

export function createInboxProfileUrl(deviceId: string, jid: string): string {
    const expires = Math.floor(Date.now() / 1000) + PROFILE_URL_TTL_SECONDS;
    const token = profileSignatureFor(deviceId, jid, expires);
    return `/inbox-profile/${encodeURIComponent(deviceId)}/${encodeURIComponent(jid)}?expires=${expires}&token=${token}`;
}

export function verifyInboxProfileToken(
    deviceId: string,
    jid: string,
    expires: number,
    token: string,
): boolean {
    const now = Math.floor(Date.now() / 1000);
    if (!Number.isSafeInteger(expires) || expires < now || expires > now + PROFILE_URL_TTL_SECONDS + 60) {
        return false;
    }
    const expected = Buffer.from(profileSignatureFor(deviceId, jid, expires), 'hex');
    let provided: Buffer;
    try {
        provided = Buffer.from(token, 'hex');
    } catch {
        return false;
    }
    return provided.length === expected.length && timingSafeEqual(provided, expected);
}
