import { createHmac, timingSafeEqual } from 'crypto';
import { jwtSecretKey } from './jwtGenerator';

const signatureFor = (deviceId: string, messageId: string) =>
    createHmac('sha256', jwtSecretKey)
        .update(`${deviceId}:${messageId}`)
        .digest('hex');

const profileSignatureFor = (deviceId: string, jid: string) =>
    createHmac('sha256', jwtSecretKey)
        .update(`profile:${deviceId}:${jid}`)
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
    return mediaPath?.startsWith('data:')
        ? createInboxMediaUrl(deviceId, messageId)
        : mediaPath;
}

export function createInboxProfileUrl(deviceId: string, jid: string): string {
    const token = profileSignatureFor(deviceId, jid);
    return `/inbox-profile/${encodeURIComponent(deviceId)}/${encodeURIComponent(jid)}?token=${token}`;
}

export function verifyInboxProfileToken(deviceId: string, jid: string, token: string): boolean {
    const expected = Buffer.from(profileSignatureFor(deviceId, jid), 'hex');
    let provided: Buffer;
    try {
        provided = Buffer.from(token, 'hex');
    } catch {
        return false;
    }
    return provided.length === expected.length && timingSafeEqual(provided, expected);
}
