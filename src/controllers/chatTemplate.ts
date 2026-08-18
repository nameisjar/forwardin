import { Prisma } from '@prisma/client';
import { RequestHandler } from 'express';
import logger from '../config/logger';
import prisma from '../utils/db';
import {
    ExistingChatTemplate,
    planChatTemplateImport,
} from '../utils/chatTemplateImport';

const MAX_TITLE_LENGTH = 128;
const MAX_MESSAGE_LENGTH = 10_000;

const normalizeInput = (body: unknown) => {
    const payload = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
    return {
        title: typeof payload.title === 'string' ? payload.title.trim() : '',
        message: typeof payload.message === 'string' ? payload.message.trim() : '',
    };
};

const validateInput = (title: string, message: string): string | null => {
    if (!title) return 'Judul template wajib diisi';
    if (title.length > MAX_TITLE_LENGTH) {
        return `Judul template maksimal ${MAX_TITLE_LENGTH} karakter`;
    }
    if (!message) return 'Isi pesan wajib diisi';
    if (message.length > MAX_MESSAGE_LENGTH) {
        return `Isi pesan maksimal ${MAX_MESSAGE_LENGTH.toLocaleString('id-ID')} karakter`;
    }
    return null;
};

const templateSelect = {
    id: true,
    title: true,
    message: true,
    createdAt: true,
    updatedAt: true,
} as const;

const sendKnownError = (error: unknown, res: Parameters<RequestHandler>[1]) => {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002') {
        res.status(409).json({ message: 'Judul template sudah digunakan' });
        return true;
    }
    return false;
};

export const getChatTemplates: RequestHandler = async (req, res) => {
    try {
        const templates = await prisma.chatTemplate.findMany({
            where: { userId: req.authenticatedUser.pkId },
            select: templateSelect,
            orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
        });
        res.status(200).json({ data: templates });
    } catch (error) {
        logger.error(error, 'Failed to load chat templates');
        res.status(500).json({ message: 'Gagal memuat template chat' });
    }
};

export const createChatTemplate: RequestHandler = async (req, res) => {
    const { title, message } = normalizeInput(req.body);
    const validationMessage = validateInput(title, message);
    if (validationMessage) return res.status(400).json({ message: validationMessage });

    try {
        const template = await prisma.chatTemplate.create({
            data: { title, message, userId: req.authenticatedUser.pkId },
            select: templateSelect,
        });
        res.status(201).json({ message: 'Template chat berhasil dibuat', data: template });
    } catch (error) {
        if (sendKnownError(error, res)) return;
        logger.error(error, 'Failed to create chat template');
        res.status(500).json({ message: 'Gagal membuat template chat' });
    }
};

export const updateChatTemplate: RequestHandler = async (req, res) => {
    const { title, message } = normalizeInput(req.body);
    const validationMessage = validateInput(title, message);
    if (validationMessage) return res.status(400).json({ message: validationMessage });

    try {
        const ownedTemplate = await prisma.chatTemplate.findFirst({
            where: { id: req.params.id, userId: req.authenticatedUser.pkId },
            select: { pkId: true },
        });
        if (!ownedTemplate) return res.status(404).json({ message: 'Template chat tidak ditemukan' });

        const template = await prisma.chatTemplate.update({
            where: { pkId: ownedTemplate.pkId },
            data: { title, message },
            select: templateSelect,
        });
        res.status(200).json({ message: 'Template chat berhasil diperbarui', data: template });
    } catch (error) {
        if (sendKnownError(error, res)) return;
        logger.error(error, 'Failed to update chat template');
        res.status(500).json({ message: 'Gagal memperbarui template chat' });
    }
};

export const deleteChatTemplate: RequestHandler = async (req, res) => {
    try {
        const result = await prisma.chatTemplate.deleteMany({
            where: { id: req.params.id, userId: req.authenticatedUser.pkId },
        });
        if (result.count === 0) {
            return res.status(404).json({ message: 'Template chat tidak ditemukan' });
        }
        res.status(200).json({ message: 'Template chat berhasil dihapus' });
    } catch (error) {
        logger.error(error, 'Failed to delete chat template');
        res.status(500).json({ message: 'Gagal menghapus template chat' });
    }
};

export const importChatTemplates: RequestHandler = async (req, res) => {
    const dryRun = req.body?.dryRun === true;

    try {
        const existingTemplates: ExistingChatTemplate[] = await prisma.chatTemplate.findMany({
            where: { userId: req.authenticatedUser.pkId },
            select: { pkId: true, id: true, title: true, message: true },
        });
        const plan = planChatTemplateImport(req.body?.rows, existingTemplates);

        if (dryRun) {
            return res.status(200).json({
                valid: plan.errors.length === 0,
                summary: plan.summary,
                errors: plan.errors,
            });
        }
        if (plan.errors.length > 0) {
            return res.status(400).json({
                message: 'Data import belum valid',
                valid: false,
                summary: plan.summary,
                errors: plan.errors,
            });
        }

        const updateRows = plan.rows.filter(
            (row): row is typeof row & { pkId: number } => row.action === 'update' && row.pkId !== undefined,
        );
        const createRows = plan.rows.filter((row) => row.action === 'create');
        const importMarker = Date.now();

        await prisma.$transaction(async (tx) => {
            // Gunakan judul sementara agar pertukaran judul antar-template tetap
            // dapat dilakukan tanpa melanggar unique constraint di tengah proses.
            for (const [index, row] of updateRows.entries()) {
                await tx.chatTemplate.update({
                    where: { pkId: row.pkId },
                    data: { title: `__import_${importMarker}_${index}_${row.pkId}` },
                });
            }
            for (const row of updateRows) {
                await tx.chatTemplate.update({
                    where: { pkId: row.pkId },
                    data: { title: row.title, message: row.message },
                });
            }
            for (const row of createRows) {
                await tx.chatTemplate.create({
                    data: {
                        title: row.title,
                        message: row.message,
                        userId: req.authenticatedUser.pkId,
                    },
                });
            }
        });

        const templates = await prisma.chatTemplate.findMany({
            where: { userId: req.authenticatedUser.pkId },
            select: templateSelect,
            orderBy: [{ updatedAt: 'desc' }, { title: 'asc' }],
        });
        return res.status(200).json({
            message: 'Template chat berhasil diimport',
            valid: true,
            summary: plan.summary,
            errors: [],
            data: templates,
        });
    } catch (error) {
        if (sendKnownError(error, res)) return;
        logger.error(error, 'Failed to import chat templates');
        return res.status(500).json({ message: 'Gagal mengimport template chat' });
    }
};
