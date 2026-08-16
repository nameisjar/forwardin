import prisma from '../utils/db';
import { getRecipients } from '../utils/recipients';

const parsedMaxRecipients = Number(process.env.BROADCAST_MAX_RECIPIENTS || 100);
export const MAX_BROADCAST_RECIPIENTS =
    Number.isFinite(parsedMaxRecipients) && parsedMaxRecipients > 0
        ? Math.floor(parsedMaxRecipients)
        : 100;

const parsedLeaseMs = Number(process.env.BROADCAST_DEVICE_LEASE_MS || 5 * 60 * 1000);
const BROADCAST_DEVICE_LEASE_MS =
    Number.isFinite(parsedLeaseMs) && parsedLeaseMs >= 60_000
        ? Math.floor(parsedLeaseMs)
        : 5 * 60 * 1000;

export class BroadcastRecipientLimitError extends Error {
    readonly statusCode = 400;

    constructor(readonly recipientCount: number, readonly maxRecipients: number) {
        super(
            `Jumlah penerima (${recipientCount}) melebihi batas keamanan ${maxRecipients} penerima per broadcast.`,
        );
        this.name = 'BroadcastRecipientLimitError';
    }
}

export function normalizeRecipientKey(value: string): string | null {
    const trimmed = String(value || '').trim().toLowerCase();
    if (!trimmed || trimmed.endsWith('@g.us') || trimmed.endsWith('@newsletter')) return null;

    const localPart = trimmed.split('@')[0];
    const digits = localPart.replace(/\D/g, '');
    return digits || null;
}

function normalizeIntentText(value: string): string {
    return String(value || '')
        .trim()
        .toUpperCase()
        .replace(/[^A-Z0-9]+/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
}

const OPT_OUT_WORDS = new Set([
    'STOP',
    'BERHENTI',
    'UNSUBSCRIBE',
    'BATAL LANGGANAN',
    'JANGAN KIRIM',
    'JANGAN KIRIM LAGI',
]);
const OPT_IN_WORDS = new Set(['START', 'MULAI', 'SUBSCRIBE', 'LANJUTKAN']);

export function classifyConsentIntent(text: string): 'opt_out' | 'opt_in' | null {
    const normalized = normalizeIntentText(text);
    if (OPT_OUT_WORDS.has(normalized)) return 'opt_out';
    if (OPT_IN_WORDS.has(normalized)) return 'opt_in';
    return null;
}

export async function applyInboundConsent(params: {
    deviceId: number;
    jid: string;
    text: string;
}): Promise<'opt_out' | 'opt_in' | null> {
    const intent = classifyConsentIntent(params.text);
    const recipientKey = normalizeRecipientKey(params.jid);
    if (!intent || !recipientKey) return null;

    if (intent === 'opt_out') {
        await prisma.whatsAppSuppression.upsert({
            where: {
                deviceId_recipientKey: {
                    deviceId: params.deviceId,
                    recipientKey,
                },
            },
            create: {
                deviceId: params.deviceId,
                recipientKey,
                reason: 'user_opt_out',
                source: 'incoming_keyword',
            },
            update: {
                reason: 'user_opt_out',
                source: 'incoming_keyword',
                updatedAt: new Date(),
            },
        });
    } else {
        await prisma.whatsAppSuppression.deleteMany({
            where: { deviceId: params.deviceId, recipientKey },
        });
    }

    return intent;
}

export async function getSuppressedRecipientKeys(
    deviceId: number,
    recipients: string[],
): Promise<Set<string>> {
    const keys = Array.from(
        new Set(recipients.map(normalizeRecipientKey).filter((key): key is string => Boolean(key))),
    );
    if (keys.length === 0) return new Set();

    const rows = await prisma.whatsAppSuppression.findMany({
        where: { deviceId, recipientKey: { in: keys } },
        select: { recipientKey: true },
    });
    return new Set(rows.map((row) => row.recipientKey));
}

export async function prepareBroadcastRecipients(params: {
    deviceId: number;
    recipients: string[];
}): Promise<{ recipients: string[]; suppressedCount: number }> {
    const resolved = Array.from(
        new Set(
            (await getRecipients(params))
                .map((recipient) => String(recipient || '').trim())
                .filter(Boolean),
        ),
    );

    if (resolved.length > MAX_BROADCAST_RECIPIENTS) {
        throw new BroadcastRecipientLimitError(resolved.length, MAX_BROADCAST_RECIPIENTS);
    }

    const suppressed = await getSuppressedRecipientKeys(params.deviceId, resolved);
    const eligible = resolved.filter((recipient) => {
        const key = normalizeRecipientKey(recipient);
        return !key || !suppressed.has(key);
    });

    return { recipients: eligible, suppressedCount: resolved.length - eligible.length };
}

function currentDay(now: Date): Date {
    return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

async function ensureOutboundState(deviceId: number): Promise<void> {
    const now = new Date();
    await prisma.deviceOutboundRateState.upsert({
        where: { deviceId },
        create: {
            deviceId,
            minuteWindowStartedAt: now,
            hourWindowStartedAt: now,
            dayWindowStartedAt: currentDay(now),
        },
        update: {},
    });
}

export async function acquireDeviceBroadcastLease(
    deviceId: number,
    broadcastId: number,
): Promise<boolean> {
    await ensureOutboundState(deviceId);
    const now = new Date();
    const leaseUntil = new Date(now.getTime() + BROADCAST_DEVICE_LEASE_MS);
    const claimed = await prisma.deviceOutboundRateState.updateMany({
        where: {
            deviceId,
            OR: [
                { broadcastLeaseId: broadcastId },
                { broadcastLeaseUntil: null },
                { broadcastLeaseUntil: { lte: now } },
            ],
        },
        data: { broadcastLeaseId: broadcastId, broadcastLeaseUntil: leaseUntil },
    });
    return claimed.count === 1;
}

export async function refreshDeviceBroadcastLease(
    deviceId: number,
    broadcastId: number,
): Promise<boolean> {
    const updated = await prisma.deviceOutboundRateState.updateMany({
        where: { deviceId, broadcastLeaseId: broadcastId },
        data: { broadcastLeaseUntil: new Date(Date.now() + BROADCAST_DEVICE_LEASE_MS) },
    });
    return updated.count === 1;
}

export async function releaseDeviceBroadcastLease(
    deviceId: number,
    broadcastId: number,
): Promise<void> {
    await prisma.deviceOutboundRateState.updateMany({
        where: { deviceId, broadcastLeaseId: broadcastId },
        data: { broadcastLeaseId: null, broadcastLeaseUntil: null },
    });
}
