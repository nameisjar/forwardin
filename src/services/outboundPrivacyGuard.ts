/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'crypto';
import {
    getBinaryNodeChild,
    getBinaryNodeChildren,
} from '@whiskeysockets/baileys';
import prisma from '../utils/db';
import logger from '../config/logger';
import { recordSignal } from './signalDetector';

const RECIPIENT_463_PAUSE_MS = Number(
    process.env.RECIPIENT_463_PAUSE_MS || 24 * 60 * 60 * 1000,
);
const TOKEN_REQUEST_COOLDOWN_MS = Number(
    process.env.TCTOKEN_REQUEST_COOLDOWN_MS || 5 * 60 * 1000,
);
const TC_TOKEN_INDEX_KEY = '__index';
const TC_TOKEN_BUCKET_SECONDS = 604800;
const TC_TOKEN_BUCKET_COUNT = 4;

type Restriction = {
    code: number;
    until: number;
};

const recipientRestrictions = new Map<string, Restriction>();
const tokenRequestFailures = new Map<string, number>();

export class OutboundPrivacyGuardError extends Error {
    readonly code: string;
    readonly statusCode = 423;

    constructor(code: string, message: string) {
        super(message);
        this.name = 'OutboundPrivacyGuardError';
        this.code = code;
    }
}

function normalizedRecipient(jid: string): string {
    return String(jid || '').split('@')[0].split(':')[0].replace(/\D/g, '');
}

function recipientHash(sessionId: string, jid: string): string {
    return createHash('sha256')
        .update(`${sessionId}:${normalizedRecipient(jid)}`)
        .digest('hex');
}

function restrictionKey(sessionId: string, jid: string): string {
    return `${sessionId}:${recipientHash(sessionId, jid)}`;
}

function isTokenExpired(timestamp: string | number | null | undefined): boolean {
    if (timestamp === null || timestamp === undefined) return true;
    const parsed = typeof timestamp === 'string' ? Number.parseInt(timestamp, 10) : timestamp;
    if (!Number.isFinite(parsed)) return true;

    const currentBucket = Math.floor(Date.now() / 1000 / TC_TOKEN_BUCKET_SECONDS);
    const cutoffBucket = currentBucket - (TC_TOKEN_BUCKET_COUNT - 1);
    return parsed < cutoffBucket * TC_TOKEN_BUCKET_SECONDS;
}

async function readTokenIndex(keys: any): Promise<string[]> {
    const data = await keys.get('tctoken', [TC_TOKEN_INDEX_KEY]);
    const entry = data?.[TC_TOKEN_INDEX_KEY];
    if (!entry?.token?.length) return [];

    try {
        const parsed = JSON.parse(Buffer.from(entry.token).toString());
        return Array.isArray(parsed)
            ? parsed.filter((item): item is string => typeof item === 'string')
            : [];
    } catch {
        return [];
    }
}

async function hasUsableToken(keys: any, storageJid: string): Promise<boolean> {
    const data = await keys.get('tctoken', [storageJid]);
    const entry = data?.[storageJid];
    return Boolean(entry?.token?.length && !isTokenExpired(entry?.timestamp));
}

export function extractTrustedContactToken(result: any): {
    token: Buffer;
    timestamp: string;
} | null {
    const tokensNode = getBinaryNodeChild(result, 'tokens');
    if (!tokensNode) return null;

    const tokenNode = getBinaryNodeChildren(tokensNode, 'token').find((node) =>
        node.attrs?.type === 'trusted_contact' &&
        node.content instanceof Uint8Array &&
        Boolean(node.attrs?.t),
    );
    if (!tokenNode || !(tokenNode.content instanceof Uint8Array)) return null;

    return {
        token: Buffer.from(tokenNode.content),
        timestamp: String(tokenNode.attrs.t),
    };
}

async function persistTokenResult(params: {
    result: any;
    storageJid: string;
    keys: any;
}): Promise<boolean> {
    const parsed = extractTrustedContactToken(params.result);
    if (!parsed) return false;

    const current = await params.keys.get('tctoken', [params.storageJid]);
    const currentEntry = current?.[params.storageJid] || {};
    const indexedJids = new Set(await readTokenIndex(params.keys));
    indexedJids.add(params.storageJid);

    await params.keys.set({
        tctoken: {
            [params.storageJid]: {
                ...currentEntry,
                token: parsed.token,
                timestamp: parsed.timestamp,
            },
            [TC_TOKEN_INDEX_KEY]: {
                token: Buffer.from(JSON.stringify([...indexedJids])),
            },
        },
    });
    return true;
}

async function getPersistedRestriction(params: {
    devicePkId: number;
    sessionId: string;
    jid: string;
}): Promise<Restriction | null> {
    const hash = recipientHash(params.sessionId, params.jid);
    const since = new Date(Date.now() - RECIPIENT_463_PAUSE_MS);
    const signal = await prisma.deviceSignal.findFirst({
        where: {
            deviceId: params.devicePkId,
            signalType: 'delivery_failed',
            code: 463,
            createdAt: { gte: since },
            metadata: {
                path: ['recipientHash'],
                equals: hash,
            },
        },
        select: { createdAt: true },
        orderBy: { createdAt: 'desc' },
    });

    if (!signal) return null;
    return {
        code: 463,
        until: signal.createdAt.getTime() + RECIPIENT_463_PAUSE_MS,
    };
}

export async function assertRecipientCanSend(params: {
    devicePkId: number;
    sessionId: string;
    jid: string;
}): Promise<void> {
    const key = restrictionKey(params.sessionId, params.jid);
    let restriction = recipientRestrictions.get(key) || null;

    if (restriction && restriction.until <= Date.now()) {
        recipientRestrictions.delete(key);
        restriction = null;
    }
    if (!restriction) {
        restriction = await getPersistedRestriction(params);
        if (restriction) recipientRestrictions.set(key, restriction);
    }
    if (!restriction) return;

    const retryAt = new Date(restriction.until);
    throw new OutboundPrivacyGuardError(
        'RECIPIENT_463_PAUSED',
        `WhatsApp menolak pengiriman ke penerima ini (kode ${restriction.code}). ` +
        `Pengiriman dijeda sampai ${retryAt.toLocaleString('id-ID')}.`,
    );
}

export async function recordRecipientRestriction(params: {
    devicePkId: number;
    sessionId: string;
    jid: string;
    code: number;
}): Promise<void> {
    if (params.code !== 463) return;

    const key = restrictionKey(params.sessionId, params.jid);
    const existing = recipientRestrictions.get(key);
    if (existing && existing.until > Date.now()) return;

    recipientRestrictions.set(key, {
        code: params.code,
        until: Date.now() + RECIPIENT_463_PAUSE_MS,
    });

    const device = await prisma.device.findUnique({
        where: { pkId: params.devicePkId },
        select: { id: true },
    });
    if (!device) return;

    await recordSignal({
        deviceId: params.devicePkId,
        deviceUuid: device.id,
        signalType: 'delivery_failed',
        code: params.code,
        message: 'WhatsApp rejected a personal outbound message',
        severity: 'warning',
        confidence: 'high',
        metadata: {
            recipientHash: recipientHash(params.sessionId, params.jid),
            pauseUntil: new Date(Date.now() + RECIPIENT_463_PAUSE_MS).toISOString(),
        },
    });
}

export async function ensureOutboundPrivacyToken(params: {
    session: any;
    devicePkId: number;
    sessionId: string;
    sourceJid: string;
    deliveryJid: string;
}): Promise<void> {
    await assertRecipientCanSend({
        devicePkId: params.devicePkId,
        sessionId: params.sessionId,
        jid: params.sourceJid,
    });

    if (params.session?.serverProps?.privacyTokenOn1to1 === false) return;
    const keys = params.session?.authState?.keys;
    if (!keys || typeof params.session?.issuePrivacyTokens !== 'function') {
        throw new OutboundPrivacyGuardError(
            'PRIVACY_TOKEN_SESSION_NOT_READY',
            'Session WhatsApp belum siap untuk validasi privacy token',
        );
    }

    const ownJids = [
        params.session?.user?.id,
        params.session?.authState?.creds?.me?.id,
        params.session?.authState?.creds?.me?.lid,
    ].filter(Boolean);
    if (ownJids.some((jid) => normalizedRecipient(jid) === normalizedRecipient(params.sourceJid))) {
        return;
    }

    let storageJid = params.deliveryJid;
    if (!storageJid.includes('@lid')) {
        storageJid =
            (await params.session?.signalRepository?.lidMapping?.getLIDForPN?.(
                params.sourceJid,
            )) || storageJid;
    }
    if (await hasUsableToken(keys, storageJid)) return;

    const requestKey = `${params.sessionId}:${storageJid}`;
    const failedAt = tokenRequestFailures.get(requestKey) || 0;
    if (Date.now() - failedAt < TOKEN_REQUEST_COOLDOWN_MS) {
        throw new OutboundPrivacyGuardError(
            'PRIVACY_TOKEN_COOLDOWN',
            'Privacy token penerima belum tersedia. Tunggu beberapa menit sebelum mencoba lagi.',
        );
    }

    const issueToLid = Boolean(params.session?.serverProps?.lidTrustedTokenIssueToLid);
    const issueJid = issueToLid ? storageJid : params.sourceJid;

    try {
        const result = await params.session.issuePrivacyTokens([
            issueJid,
        ], Math.floor(Date.now() / 1000));
        await persistTokenResult({ result, storageJid, keys });
    } catch (error) {
        tokenRequestFailures.set(requestKey, Date.now());
        logger.warn(
            { error: error instanceof Error ? error.message : 'Privacy token request failed' },
            '[PrivacyGuard] Failed to request recipient privacy token',
        );
        throw new OutboundPrivacyGuardError(
            'PRIVACY_TOKEN_REQUEST_FAILED',
            'WhatsApp belum memberikan privacy token untuk penerima ini',
        );
    }

    if (!(await hasUsableToken(keys, storageJid))) {
        tokenRequestFailures.set(requestKey, Date.now());
        throw new OutboundPrivacyGuardError(
            'PRIVACY_TOKEN_UNAVAILABLE',
            'WhatsApp belum memberikan izin linked device untuk mengirim ke penerima ini. ' +
            'Pesan dibatalkan agar tidak memicu penolakan berulang.',
        );
    }

    tokenRequestFailures.delete(requestKey);
    logger.info(
        { addressing: storageJid.includes('@lid') ? 'lid' : 'pn' },
        '[PrivacyGuard] Recipient privacy token ready',
    );
}

export const privacyGuardConfig = {
    recipientPauseMs: RECIPIENT_463_PAUSE_MS,
    tokenRequestCooldownMs: TOKEN_REQUEST_COOLDOWN_MS,
};
