import schedule from 'node-schedule';
import logger from '../config/logger';
import prisma from '../utils/db';
import { cleanupMediaFilesIfUnreferenced, cleanupOrphanedMediaFiles } from './mediaCleanup';

export const DEFAULT_INBOX_RETENTION_DAYS = 90;
export const DEFAULT_INBOX_GRACE_DAYS = 7;
export const MIN_INBOX_RETENTION_DAYS = 1;
export const MAX_INBOX_RETENTION_DAYS = 3650;

type CleanupTrigger = 'automatic' | 'manual';

export interface InboxCleanupPreview {
    cutoffAt: Date;
    incomingToHide: number;
    outgoingToHide: number;
    incomingPendingDeletion: number;
    outgoingPendingDeletion: number;
    affectedDevices: number;
}

export interface InboxCleanupResult extends InboxCleanupPreview {
    incomingHidden: number;
    outgoingHidden: number;
    incomingDeleted: number;
    outgoingDeleted: number;
    reactionsDeleted: number;
    mediaDeleted: number;
    mediaDeleteFailed: number;
    orphanMediaDeleted: number;
}

let cleanupRunning = false;
let retentionJob: schedule.Job | null = null;

export function normalizeRetentionDays(value: unknown): number {
    const days = Number(value);
    if (
        !Number.isInteger(days) ||
        days < MIN_INBOX_RETENTION_DAYS ||
        days > MAX_INBOX_RETENTION_DAYS
    ) {
        throw new Error(
            `Masa penyimpanan harus berupa angka ${MIN_INBOX_RETENTION_DAYS}-${MAX_INBOX_RETENTION_DAYS} hari`,
        );
    }
    return days;
}

export function calculateInboxCutoff(retentionDays: number, now = new Date()): Date {
    return new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
}

export async function getInboxRetentionSetting() {
    return prisma.inboxRetentionSetting.upsert({
        where: { pkId: 1 },
        update: {},
        create: {
            pkId: 1,
            enabled: true,
            retentionDays: DEFAULT_INBOX_RETENTION_DAYS,
            graceDays: DEFAULT_INBOX_GRACE_DAYS,
        },
    });
}

export async function updateInboxRetentionSetting(input: {
    enabled: boolean;
    retentionDays: number;
    updatedBy: string;
}) {
    const retentionDays = normalizeRetentionDays(input.retentionDays);
    return prisma.inboxRetentionSetting.upsert({
        where: { pkId: 1 },
        update: {
            enabled: input.enabled,
            retentionDays,
            updatedBy: input.updatedBy,
        },
        create: {
            pkId: 1,
            enabled: input.enabled,
            retentionDays,
            graceDays: DEFAULT_INBOX_GRACE_DAYS,
            updatedBy: input.updatedBy,
        },
    });
}

export async function previewInboxCleanup(
    retentionDays: number,
    graceDays = DEFAULT_INBOX_GRACE_DAYS,
    now = new Date(),
): Promise<InboxCleanupPreview> {
    const cutoffAt = calculateInboxCutoff(normalizeRetentionDays(retentionDays), now);
    const permanentDeleteBefore = calculateInboxCutoff(graceDays, now);

    const [
        incomingToHide,
        outgoingToHide,
        incomingPendingDeletion,
        outgoingPendingDeletion,
        incomingDevices,
        outgoingDevices,
    ] = await Promise.all([
        prisma.incomingMessage.count({
            where: { inboxHiddenAt: null, receivedAt: { lt: cutoffAt } },
        }),
        prisma.outgoingMessage.count({
            where: { inboxHiddenAt: null, createdAt: { lt: cutoffAt } },
        }),
        prisma.incomingMessage.count({
            where: { inboxHiddenAt: { lt: permanentDeleteBefore } },
        }),
        prisma.outgoingMessage.count({
            where: { inboxHiddenAt: { lt: permanentDeleteBefore } },
        }),
        prisma.incomingMessage.groupBy({
            by: ['deviceId'],
            where: {
                deviceId: { not: null },
                inboxHiddenAt: null,
                receivedAt: { lt: cutoffAt },
            },
        }),
        prisma.outgoingMessage.groupBy({
            by: ['deviceId'],
            where: {
                deviceId: { not: null },
                inboxHiddenAt: null,
                createdAt: { lt: cutoffAt },
            },
        }),
    ]);

    const deviceIds = new Set<number>();
    incomingDevices.forEach((item) => item.deviceId && deviceIds.add(item.deviceId));
    outgoingDevices.forEach((item) => item.deviceId && deviceIds.add(item.deviceId));

    return {
        cutoffAt,
        incomingToHide,
        outgoingToHide,
        incomingPendingDeletion,
        outgoingPendingDeletion,
        affectedDevices: deviceIds.size,
    };
}

async function purgeExpiredIncomingMessages(permanentDeleteBefore: Date) {
    let incomingDeleted = 0;
    let mediaDeleted = 0;
    let mediaDeleteFailed = 0;

    for (;;) {
        const batch = await prisma.incomingMessage.findMany({
            where: { inboxHiddenAt: { lt: permanentDeleteBefore } },
            select: { pkId: true, mediaPath: true },
            orderBy: { pkId: 'asc' },
            take: 500,
        });
        if (batch.length === 0) break;

        const deleted = await prisma.incomingMessage.deleteMany({
            where: { pkId: { in: batch.map((item) => item.pkId) } },
        });
        incomingDeleted += deleted.count;
        const cleanup = await cleanupMediaFilesIfUnreferenced(
            batch.map((item) => item.mediaPath),
            'inbox-retention-incoming',
        );
        mediaDeleted += cleanup.deleted;
        mediaDeleteFailed += cleanup.failed;

        if (batch.length < 500) break;
        await new Promise((resolve) => setImmediate(resolve));
    }

    return { incomingDeleted, mediaDeleted, mediaDeleteFailed };
}

async function purgeExpiredOutgoingMessages(permanentDeleteBefore: Date) {
    let outgoingDeleted = 0;
    let mediaDeleted = 0;
    let mediaDeleteFailed = 0;

    for (;;) {
        const batch = await prisma.outgoingMessage.findMany({
            where: { inboxHiddenAt: { lt: permanentDeleteBefore } },
            select: { pkId: true, mediaPath: true },
            orderBy: { pkId: 'asc' },
            take: 500,
        });
        if (batch.length === 0) break;

        const deleted = await prisma.outgoingMessage.deleteMany({
            where: { pkId: { in: batch.map((item) => item.pkId) } },
        });
        outgoingDeleted += deleted.count;
        const cleanup = await cleanupMediaFilesIfUnreferenced(
            batch.map((item) => item.mediaPath),
            'inbox-retention-outgoing',
        );
        mediaDeleted += cleanup.deleted;
        mediaDeleteFailed += cleanup.failed;

        if (batch.length < 500) break;
        await new Promise((resolve) => setImmediate(resolve));
    }

    return { outgoingDeleted, mediaDeleted, mediaDeleteFailed };
}

export async function runInboxCleanup(
    triggerType: CleanupTrigger,
    triggeredBy?: string,
): Promise<InboxCleanupResult> {
    if (cleanupRunning) throw new Error('Pembersihan Inbox sedang berjalan');
    cleanupRunning = true;

    try {
        const setting = await getInboxRetentionSetting();
        if (!setting.enabled && triggerType === 'automatic') {
            throw new Error('Pembersihan otomatis Inbox sedang dinonaktifkan');
        }

        const now = new Date();
        const preview = await previewInboxCleanup(setting.retentionDays, setting.graceDays, now);
        const permanentDeleteBefore = calculateInboxCutoff(setting.graceDays, now);

        const [incomingResult, outgoingResult, reactionResult] = await prisma.$transaction([
            prisma.incomingMessage.updateMany({
                where: { inboxHiddenAt: null, receivedAt: { lt: preview.cutoffAt } },
                data: { inboxHiddenAt: now },
            }),
            prisma.outgoingMessage.updateMany({
                where: { inboxHiddenAt: null, createdAt: { lt: preview.cutoffAt } },
                data: { inboxHiddenAt: now },
            }),
            prisma.messageReaction.deleteMany({
                where: { reactedAt: { lt: preview.cutoffAt } },
            }),
        ]);

        const incomingPurge = await purgeExpiredIncomingMessages(permanentDeleteBefore);
        const outgoingPurge = await purgeExpiredOutgoingMessages(permanentDeleteBefore);
        const orphanCleanup = await cleanupOrphanedMediaFiles();
        const mediaDeleted =
            incomingPurge.mediaDeleted + outgoingPurge.mediaDeleted + orphanCleanup.deleted;
        const mediaDeleteFailed =
            incomingPurge.mediaDeleteFailed +
            outgoingPurge.mediaDeleteFailed +
            orphanCleanup.failed;
        await prisma.$transaction([
            prisma.inboxRetentionSetting.update({
                where: { pkId: 1 },
                data: { lastCleanupAt: now },
            }),
            prisma.inboxCleanupLog.create({
                data: {
                    triggerType,
                    triggeredBy,
                    cutoffAt: preview.cutoffAt,
                    incomingHiddenCount: incomingResult.count,
                    outgoingHiddenCount: outgoingResult.count,
                    incomingDeletedCount: incomingPurge.incomingDeleted,
                    outgoingDeletedCount: outgoingPurge.outgoingDeleted,
                    reactionDeletedCount: reactionResult.count,
                    mediaDeletedCount: mediaDeleted,
                    mediaDeleteFailedCount: mediaDeleteFailed,
                },
            }),
        ]);

        const result: InboxCleanupResult = {
            ...preview,
            incomingHidden: incomingResult.count,
            outgoingHidden: outgoingResult.count,
            incomingDeleted: incomingPurge.incomingDeleted,
            outgoingDeleted: outgoingPurge.outgoingDeleted,
            reactionsDeleted: reactionResult.count,
            mediaDeleted,
            mediaDeleteFailed,
            orphanMediaDeleted: orphanCleanup.deleted,
        };
        logger.info({ ...result, triggerType }, 'Inbox retention cleanup completed');
        return result;
    } finally {
        cleanupRunning = false;
    }
}

export function startInboxRetentionScheduler(): void {
    if (retentionJob) return;
    const timezone = process.env.APP_TIMEZONE || 'Asia/Jayapura';
    retentionJob = schedule.scheduleJob({ rule: '30 2 * * *', tz: timezone }, async () => {
        try {
            await runInboxCleanup('automatic', 'system');
        } catch (error) {
            if ((error as Error).message === 'Pembersihan otomatis Inbox sedang dinonaktifkan') {
                // Orphan cleanup is storage maintenance and remains safe even
                // when the administrator disables age-based message retention.
                await cleanupOrphanedMediaFiles();
            } else {
                logger.error({ error }, 'Automatic Inbox retention cleanup failed');
            }
        }
    });
    logger.info({ timezone }, '[InboxRetention] Daily cleanup scheduled at 02:30');
}

export function stopInboxRetentionScheduler(): void {
    retentionJob?.cancel();
    retentionJob = null;
}
