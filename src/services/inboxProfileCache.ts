import axios from 'axios';
import { createHash } from 'crypto';
import https from 'https';
import { Prisma } from '@prisma/client';
import logger from '../config/logger';
import prisma from '../utils/db';

const PROFILE_TTL_MS = 24 * 60 * 60 * 1000;
const NEGATIVE_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_PROFILE_BYTES = 5 * 1024 * 1024;
const inFlight = new Map<string, Promise<ProfileRefreshResult>>();
let missingTableWarningLogged = false;

const profileHttpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    maxSockets: 10,
});

export type ProfileCacheStatus = 'pending' | 'available' | 'unavailable' | 'failed';

export type ProfileCacheEntry = {
    deviceId: number;
    jid: string;
    imageData: Buffer | null;
    mimeType: string | null;
    status: ProfileCacheStatus;
    fetchedAt: Date | null;
    expiresAt: Date | null;
    nextRetryAt: Date | null;
    failureCount: number;
};

type ProfileCacheSummaryRow = {
    jid: string;
    status: ProfileCacheStatus;
    has_image: boolean;
    expires_at: Date | null;
    next_retry_at: Date | null;
};

export type ProfileCacheSummary = {
    status: ProfileCacheStatus;
    hasImage: boolean;
    expiresAt: Date | null;
    nextRetryAt: Date | null;
};

export type ProfileRefreshResult = {
    status: ProfileCacheStatus;
    hasImage: boolean;
};

type ProfilePictureSession = {
    profilePictureUrl: (jid: string, type?: 'preview' | 'image') => Promise<string | undefined>;
};

function safeJidRef(jid: string): string {
    return createHash('sha256').update(jid).digest('hex').slice(0, 12);
}

function errorCode(error: unknown): string {
    if (axios.isAxiosError(error)) {
        return String(error.response?.status || error.code || 'AXIOS_ERROR').slice(0, 64);
    }
    if (error && typeof error === 'object' && 'code' in error) {
        return String((error as { code?: unknown }).code || 'UNKNOWN').slice(0, 64);
    }
    return 'UNKNOWN';
}

function isMissingCacheTable(error: unknown): boolean {
    return Boolean(
        error &&
            typeof error === 'object' &&
            ('code' in error && String((error as { code?: unknown }).code) === 'P2010') &&
            JSON.stringify(error).includes('42P01'),
    );
}

function reportCacheQueryError(error: unknown): void {
    if (isMissingCacheTable(error)) {
        if (!missingTableWarningLogged) {
            missingTableWarningLogged = true;
            logger.warn('[InboxProfile] Cache table is unavailable; run prisma migrate deploy');
        }
        return;
    }
    logger.error({ code: errorCode(error) }, '[InboxProfile] Cache query failed');
}

export async function getInboxProfileCache(
    deviceId: number,
    jid: string,
): Promise<ProfileCacheEntry | null> {
    try {
        const rows = await prisma.$queryRaw<ProfileCacheEntry[]>`
            SELECT
                "device_id" AS "deviceId",
                "jid",
                "image_data" AS "imageData",
                "mime_type" AS "mimeType",
                "status",
                "fetched_at" AS "fetchedAt",
                "expires_at" AS "expiresAt",
                "next_retry_at" AS "nextRetryAt",
                "failure_count" AS "failureCount"
            FROM "inbox_profile_cache"
            WHERE "device_id" = ${deviceId} AND "jid" = ${jid}
            LIMIT 1
        `;
        return rows[0] || null;
    } catch (error) {
        reportCacheQueryError(error);
        return null;
    }
}

export async function getInboxProfileCacheSummaries(
    deviceId: number,
    jids: string[],
): Promise<Map<string, ProfileCacheSummary>> {
    const uniqueJids = [...new Set(jids.filter(Boolean))];
    if (uniqueJids.length === 0) return new Map();

    try {
        const rows = await prisma.$queryRaw<ProfileCacheSummaryRow[]>(Prisma.sql`
            SELECT
                "jid",
                "status",
                ("image_data" IS NOT NULL) AS "has_image",
                "expires_at",
                "next_retry_at"
            FROM "inbox_profile_cache"
            WHERE "device_id" = ${deviceId}
              AND "jid" IN (${Prisma.join(uniqueJids)})
        `);
        return new Map(
            rows.map((row) => [
                row.jid,
                {
                    status: row.status,
                    hasImage: row.has_image,
                    expiresAt: row.expires_at,
                    nextRetryAt: row.next_retry_at,
                },
            ]),
        );
    } catch (error) {
        reportCacheQueryError(error);
        return new Map();
    }
}

async function setPending(deviceId: number, jid: string): Promise<void> {
    await prisma.$executeRaw`
        INSERT INTO "inbox_profile_cache" (
            "device_id", "jid", "status", "created_at", "updated_at"
        ) VALUES (${deviceId}, ${jid}, 'pending', NOW(), NOW())
        ON CONFLICT ("device_id", "jid") DO UPDATE SET
            "status" = CASE
                WHEN "inbox_profile_cache"."image_data" IS NULL THEN 'pending'
                ELSE "inbox_profile_cache"."status"
            END,
            "updated_at" = NOW()
    `;
}

async function setAvailable(
    deviceId: number,
    jid: string,
    imageData: Buffer,
    mimeType: string,
): Promise<void> {
    const expiresAt = new Date(Date.now() + PROFILE_TTL_MS);
    await prisma.$executeRaw`
        INSERT INTO "inbox_profile_cache" (
            "device_id", "jid", "image_data", "mime_type", "status",
            "fetched_at", "expires_at", "next_retry_at", "failure_count",
            "last_error_code", "created_at", "updated_at"
        ) VALUES (
            ${deviceId}, ${jid}, ${imageData}, ${mimeType}, 'available',
            NOW(), ${expiresAt}, NULL, 0, NULL, NOW(), NOW()
        )
        ON CONFLICT ("device_id", "jid") DO UPDATE SET
            "image_data" = EXCLUDED."image_data",
            "mime_type" = EXCLUDED."mime_type",
            "status" = 'available',
            "fetched_at" = NOW(),
            "expires_at" = EXCLUDED."expires_at",
            "next_retry_at" = NULL,
            "failure_count" = 0,
            "last_error_code" = NULL,
            "updated_at" = NOW()
    `;
}

async function setUnavailableOrFailed(
    deviceId: number,
    jid: string,
    status: 'unavailable' | 'failed',
    code: string,
    previous: ProfileCacheEntry | null,
): Promise<ProfileRefreshResult> {
    const failureCount = Math.min((previous?.failureCount || 0) + 1, 8);
    const retryMs = status === 'unavailable'
        ? NEGATIVE_TTL_MS
        : Math.min(NEGATIVE_TTL_MS, 5 * 60 * 1000 * 2 ** (failureCount - 1));
    const nextRetryAt = new Date(Date.now() + retryMs);
    const keepStaleImage = Boolean(previous?.imageData?.length);

    await prisma.$executeRaw`
        INSERT INTO "inbox_profile_cache" (
            "device_id", "jid", "status", "next_retry_at", "failure_count",
            "last_error_code", "created_at", "updated_at"
        ) VALUES (
            ${deviceId}, ${jid}, ${status}, ${nextRetryAt}, ${failureCount},
            ${code}, NOW(), NOW()
        )
        ON CONFLICT ("device_id", "jid") DO UPDATE SET
            "status" = CASE
                WHEN "inbox_profile_cache"."image_data" IS NOT NULL THEN 'available'
                ELSE EXCLUDED."status"
            END,
            "next_retry_at" = EXCLUDED."next_retry_at",
            "failure_count" = EXCLUDED."failure_count",
            "last_error_code" = EXCLUDED."last_error_code",
            "updated_at" = NOW()
    `;

    return { status: keepStaleImage ? 'available' : status, hasImage: keepStaleImage };
}

function validateProfileSource(source: string): URL | null {
    try {
        const url = new URL(source);
        const host = url.hostname.toLowerCase();
        if (url.protocol !== 'https:') return null;
        if (host !== 'whatsapp.net' && !host.endsWith('.whatsapp.net')) return null;
        return url;
    } catch {
        return null;
    }
}

async function fetchProfileSource(session: ProfilePictureSession, jid: string): Promise<string | null> {
    try {
        const source = await session.profilePictureUrl(jid, 'image');
        if (source) return source;
    } catch {
        // Preview may still be available when the high-resolution image is private.
    }
    try {
        return (await session.profilePictureUrl(jid, 'preview')) || null;
    } catch {
        return null;
    }
}

async function downloadProfile(source: string): Promise<{ data: Buffer; mimeType: string }> {
    const safeSource = validateProfileSource(source);
    if (!safeSource) throw Object.assign(new Error('Invalid profile source'), { code: 'INVALID_SOURCE' });

    const response = await axios.get<Buffer>(safeSource.toString(), {
        responseType: 'arraybuffer',
        timeout: 15_000,
        maxContentLength: MAX_PROFILE_BYTES,
        maxBodyLength: MAX_PROFILE_BYTES,
        httpsAgent: profileHttpsAgent,
        headers: { Accept: 'image/*', 'User-Agent': 'Mozilla/5.0' },
    });
    const data = Buffer.from(response.data);
    const rawMimeType = response.headers['content-type'];
    const mimeType = typeof rawMimeType === 'string' ? rawMimeType.split(';')[0].trim() : '';
    if (!data.length || data.length > MAX_PROFILE_BYTES || !mimeType.startsWith('image/')) {
        throw Object.assign(new Error('Invalid profile response'), { code: 'INVALID_IMAGE' });
    }
    return { data, mimeType };
}

/**
 * Refresh a profile in the background. Concurrent requests for the same
 * device/JID share one promise, preventing duplicate WhatsApp/CDN calls.
 */
export function refreshInboxProfileCache(params: {
    deviceId: number;
    jid: string;
    session: ProfilePictureSession;
    force?: boolean;
}): Promise<ProfileRefreshResult> {
    const key = `${params.deviceId}:${params.jid}`;
    const running = inFlight.get(key);
    if (running) return running;

    const task = (async (): Promise<ProfileRefreshResult> => {
        let previous: ProfileCacheEntry | null = null;
        try {
            previous = await getInboxProfileCache(params.deviceId, params.jid);
            const now = Date.now();
            if (!params.force) {
                if (
                    previous?.imageData?.length &&
                    previous.expiresAt &&
                    previous.expiresAt.getTime() > now
                ) {
                    return { status: 'available', hasImage: true };
                }
                if (previous?.nextRetryAt && previous.nextRetryAt.getTime() > now) {
                    return { status: previous.status, hasImage: Boolean(previous.imageData?.length) };
                }
            }

            await setPending(params.deviceId, params.jid);
            const source = await fetchProfileSource(params.session, params.jid);
            if (!source) {
                return await setUnavailableOrFailed(
                    params.deviceId,
                    params.jid,
                    'unavailable',
                    'NOT_AVAILABLE',
                    previous,
                );
            }

            const picture = await downloadProfile(source);
            await setAvailable(params.deviceId, params.jid, picture.data, picture.mimeType);
            logger.debug(
                { deviceId: params.deviceId, jidRef: safeJidRef(params.jid), bytes: picture.data.length },
                '[InboxProfile] Profile cached',
            );
            return { status: 'available', hasImage: true };
        } catch (error) {
            const code = errorCode(error);
            if (isMissingCacheTable(error)) {
                reportCacheQueryError(error);
            } else {
                logger.debug(
                    { deviceId: params.deviceId, jidRef: safeJidRef(params.jid), code },
                    '[InboxProfile] Refresh did not produce a new image',
                );
            }
            try {
                return await setUnavailableOrFailed(
                    params.deviceId,
                    params.jid,
                    'failed',
                    code,
                    previous,
                );
            } catch (cacheError) {
                reportCacheQueryError(cacheError);
                return { status: 'failed', hasImage: Boolean(previous?.imageData?.length) };
            }
        }
    })().finally(() => inFlight.delete(key));

    inFlight.set(key, task);
    return task;
}

/** Warm recent conversations after the owning WhatsApp session is connected. */
export async function warmInboxProfileCache(params: {
    deviceId: number;
    sessionId: string;
    session: ProfilePictureSession;
    onAvailable?: (jid: string) => void | Promise<void>;
}): Promise<void> {
    try {
        const [incoming, outgoing] = await Promise.all([
            prisma.incomingMessage.findMany({
                where: { deviceId: params.deviceId },
                orderBy: { receivedAt: 'desc' },
                take: 100,
                select: { from: true, profilePicUrl: true, groupPicUrl: true },
            }),
            prisma.outgoingMessage.findMany({
                where: { sessionId: params.sessionId },
                orderBy: { createdAt: 'desc' },
                take: 100,
                select: { to: true },
            }),
        ]);
        const jids = [
            ...new Set(
                [...incoming.map((item) => item.from), ...outgoing.map((item) => item.to)]
                    .filter((jid) => Boolean(jid) && !jid.endsWith('@lid')),
            ),
        ].slice(0, 50);

        // Import the safe binary cache used by older releases. This runs in
        // application code so one malformed legacy value cannot abort a DB
        // migration during deployment.
        const legacySourceByJid = new Map<string, string>();
        for (const item of incoming) {
            if (legacySourceByJid.has(item.from)) continue;
            const source = item.from.endsWith('@g.us') ? item.groupPicUrl : item.profilePicUrl;
            if (source?.startsWith('data:image/')) legacySourceByJid.set(item.from, source);
        }
        for (const [jid, source] of legacySourceByJid) {
            try {
                const match = source.match(/^data:(image\/[^;,]+);base64,([A-Za-z0-9+/=]+)$/);
                if (!match) continue;
                const data = Buffer.from(match[2], 'base64');
                if (!data.length || data.length > MAX_PROFILE_BYTES) continue;
                await setAvailable(params.deviceId, jid, data, match[1]);
            } catch {
                // Ignore malformed legacy values and fetch a fresh copy below.
            }
        }

        const queue = [...jids];
        const worker = async () => {
            while (queue.length > 0) {
                const jid = queue.shift();
                if (!jid) return;
                const result = await refreshInboxProfileCache({
                    deviceId: params.deviceId,
                    jid,
                    session: params.session,
                });
                if (result.hasImage) await params.onAvailable?.(jid);
                await new Promise((resolve) => setTimeout(resolve, 250));
            }
        };
        await Promise.allSettled([worker(), worker()]);
        logger.info(
            { deviceId: params.deviceId, conversations: jids.length },
            '[InboxProfile] Recent conversation cache warmed',
        );
    } catch (error) {
        logger.warn(
            { deviceId: params.deviceId, code: errorCode(error) },
            '[InboxProfile] Cache warm-up failed',
        );
    }
}
