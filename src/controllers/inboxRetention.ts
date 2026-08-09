import { RequestHandler } from 'express';
import logger from '../config/logger';
import {
    getInboxRetentionSetting,
    normalizeRetentionDays,
    previewInboxCleanup,
    runInboxCleanup,
    updateInboxRetentionSetting,
} from '../services/inboxRetention';
import prisma from '../utils/db';

function actorLabel(req: Parameters<RequestHandler>[0]): string {
    const user = req.authenticatedUser;
    return user.email || user.username || user.id || `user-${user.pkId}`;
}

export const getRetentionConfiguration: RequestHandler = async (req, res) => {
    try {
        const setting = await getInboxRetentionSetting();
        const [preview, logs] = await Promise.all([
            previewInboxCleanup(setting.retentionDays, setting.graceDays),
            prisma.inboxCleanupLog.findMany({
                orderBy: { createdAt: 'desc' },
                take: 20,
            }),
        ]);

        res.status(200).json({
            setting,
            preview,
            logs: logs.map((log) => ({ ...log, pkId: log.pkId.toString() })),
            schedule: {
                time: '02:30',
                timezone: process.env.APP_TIMEZONE || 'Asia/Jayapura',
            },
        });
    } catch (error) {
        logger.error({ error }, 'Failed to load Inbox retention configuration');
        res.status(500).json({ message: 'Gagal memuat pengaturan retensi Inbox' });
    }
};

export const updateRetentionConfiguration: RequestHandler = async (req, res) => {
    try {
        if (typeof req.body.enabled !== 'boolean') {
            return res.status(400).json({ message: 'Status retensi otomatis tidak valid' });
        }

        const retentionDays = normalizeRetentionDays(req.body.retentionDays);
        const setting = await updateInboxRetentionSetting({
            enabled: req.body.enabled,
            retentionDays,
            updatedBy: actorLabel(req),
        });
        const preview = await previewInboxCleanup(setting.retentionDays, setting.graceDays);

        res.status(200).json({
            message: setting.enabled
                ? `Pembersihan otomatis aktif untuk pesan lebih lama dari ${setting.retentionDays} hari`
                : 'Pembersihan otomatis Inbox dinonaktifkan',
            setting,
            preview,
        });
    } catch (error) {
        if ((error as Error).message.includes('Masa penyimpanan')) {
            return res.status(400).json({ message: (error as Error).message });
        }
        logger.error({ error }, 'Failed to update Inbox retention configuration');
        res.status(500).json({ message: 'Gagal menyimpan pengaturan retensi Inbox' });
    }
};

export const cleanupInboxNow: RequestHandler = async (req, res) => {
    try {
        const result = await runInboxCleanup('manual', actorLabel(req));
        res.status(200).json({
            message: `Pembersihan selesai. ${result.incomingHidden + result.outgoingHidden} pesan disembunyikan dari Inbox.`,
            result,
        });
    } catch (error) {
        if ((error as Error).message === 'Pembersihan Inbox sedang berjalan') {
            return res.status(409).json({ message: (error as Error).message });
        }
        logger.error({ error }, 'Manual Inbox retention cleanup failed');
        res.status(500).json({ message: 'Gagal menjalankan pembersihan Inbox' });
    }
};
