/* eslint-disable @typescript-eslint/no-explicit-any */
import { createHash } from 'crypto';
import prisma from '../utils/db';
import { recordSignal } from './signalDetector';

const RECIPIENT_463_PAUSE_MS = Number(
    process.env.RECIPIENT_463_PAUSE_MS || 24 * 60 * 60 * 1000,
);
const RECIPIENT_463_BLOCK_ENABLED =
    String(process.env.RECIPIENT_463_BLOCK_ENABLED || 'false').toLowerCase() === 'true';
type Restriction = {
    code: number;
    until: number;
};

const recipientRestrictions = new Map<string, Restriction>();

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
    // Preserve the original permissive send behavior by default. We still
    // record confirmed 463 receipts for monitoring, but only enforce a local
    // cooldown when an operator explicitly enables it.
    if (!RECIPIENT_463_BLOCK_ENABLED) return;

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

    if (RECIPIENT_463_BLOCK_ENABLED) {
        const key = restrictionKey(params.sessionId, params.jid);
        const existing = recipientRestrictions.get(key);
        if (existing && existing.until > Date.now()) return;

        recipientRestrictions.set(key, {
            code: params.code,
            until: Date.now() + RECIPIENT_463_PAUSE_MS,
        });
    }

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
            localBlockEnabled: RECIPIENT_463_BLOCK_ENABLED,
            pauseUntil: RECIPIENT_463_BLOCK_ENABLED
                ? new Date(Date.now() + RECIPIENT_463_PAUSE_MS).toISOString()
                : null,
        },
    });
}

/**
 * Optionally block recipients that WhatsApp has actually rejected with receipt
 * 463. Blocking is disabled by default to preserve the legacy direct-send flow.
 *
 * Baileys owns the trusted-contact token lifecycle. It attaches an existing
 * token, issues a new one after a send, and attempts recovery after a 463.
 * Requiring a token before send creates a deadlock for contacts whose first
 * successful outbound message is needed to establish that lifecycle.
 */
export async function assertOutboundRecipientAvailable(params: {
    devicePkId: number;
    sessionId: string;
    jid: string;
}): Promise<void> {
    await assertRecipientCanSend({
        devicePkId: params.devicePkId,
        sessionId: params.sessionId,
        jid: params.jid,
    });
}

export const privacyGuardConfig = {
    recipientBlockEnabled: RECIPIENT_463_BLOCK_ENABLED,
    recipientPauseMs: RECIPIENT_463_PAUSE_MS,
};
