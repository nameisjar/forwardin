import { createHmac, timingSafeEqual } from 'crypto';
import { jwtSecretKey } from './jwtGenerator';

export type InboxMediaType = 'image' | 'video' | 'audio' | 'document';

const MEDIA_EXTENSIONS: Record<InboxMediaType, ReadonlySet<string>> = {
    image: new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']),
    video: new Set(['mp4', 'mov', 'webm', 'mkv']),
    audio: new Set(['mp3', 'ogg', 'wav', 'm4a', 'aac', 'opus']),
    document: new Set(),
};

const mediaExtension = (value: string | null | undefined): string => {
    const normalized = String(value || '')
        .split(/[?#]/)[0]
        .replace(/\\/g, '/')
        .toLowerCase();
    const fileName = normalized.split('/').pop() || '';
    return fileName.includes('.') ? fileName.slice(fileName.lastIndexOf('.') + 1) : '';
};

/**
 * Resolve the original media kind before its filesystem path is replaced by a
 * signed Inbox URL. Signed URLs intentionally do not expose an extension, so
 * the browser cannot reliably infer the kind on its own.
 */
export function resolveInboxMediaType(
    mediaPath: string | null | undefined,
    fileName?: string | null,
    messageText?: string | null,
): InboxMediaType | null {
    if (!mediaPath) return null;

    const dataMime = String(mediaPath).match(/^data:([^;,]+)/i)?.[1]?.toLowerCase();
    if (dataMime?.startsWith('image/')) return 'image';
    if (dataMime?.startsWith('video/')) return 'video';
    if (dataMime?.startsWith('audio/')) return 'audio';

    const extension = mediaExtension(fileName) || mediaExtension(mediaPath);
    for (const mediaType of ['image', 'video', 'audio'] as const) {
        if (MEDIA_EXTENSIONS[mediaType].has(extension)) return mediaType;
    }

    const placeholder = String(messageText || '').trim().toLowerCase();
    if (placeholder === '[gambar]' || placeholder === '[stiker]') return 'image';
    if (placeholder === '[video]') return 'video';
    if (placeholder === '[audio]') return 'audio';
    return 'document';
}

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
