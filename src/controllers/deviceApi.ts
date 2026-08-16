import { RequestHandler } from 'express';
import { getInstance, verifyJid, sendButtonMessage, getJid } from '../whatsapp';
import logger from '../config/logger';
import prisma, { serializePrisma } from '../utils/db';
import { delay as delayMs } from '../utils/delay';
import { diskUpload, getMediaUploadErrorMessage, memoryUpload } from '../config/multer';
import { isUUID } from '../utils/uuidChecker';
import fs from 'fs';
import path from 'path';
import { generateMonthlyFeedbackPDFWithPuppeteer } from '../services/pdfGenerator';
import { setDeviceAsPersonal, setDeviceAsShared } from '../services/rateLimiter';
import { sendMonthlyFeedbackBatch } from '../services/monthlyFeedbackSender';
import { redactPhone } from '../utils/logRedaction';
import {
    decryptBroadcasts,
    decryptIncomingMessage,
    decryptOutgoingMessage,
    encryptMessage,
} from '../utils/messageEncryption';
import { getSocketIO } from '../socket';
import { deleteMessageReactions, saveMessageReaction } from '../services/messageReaction';
import { cleanupMediaFilesIfUnreferenced } from '../services/mediaCleanup';
import axios from 'axios';
import https from 'https';
import { sendGenericMessage } from '../services/messageSender';
import { createTrackedMessageId } from '../utils/outgoingMessageId';
import { sanitizeMediaFileName } from '../utils/mediaFileName';

const PROFILE_PICTURE_CACHE_TTL_MS = 5 * 60 * 1000;
const PROFILE_PICTURE_MAX_BYTES = 5 * 1024 * 1024;
const profilePictureHttpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    maxSockets: 20,
});
const profilePictureCache = new Map<
    string,
    { data: Buffer; contentType: string; expiresAt: number }
>();

type QueuedMediaType = 'image' | 'document' | 'audio' | 'video';

const inboxMessageContactSelect = {
    id: true,
    firstName: true,
    lastName: true,
    phone: true,
    colorCode: true,
    ContactLabel: {
        select: {
            label: {
                select: { name: true },
            },
        },
    },
} as const;

async function cleanupUnpersistedUpload(
    mediaPath: string | undefined,
    persisted: boolean,
    reason: string,
): Promise<void> {
    if (!mediaPath || persisted) return;
    await cleanupMediaFilesIfUnreferenced([mediaPath], reason);
}

async function markPendingMessageAsFailed(messageId: string, clearMedia = false): Promise<void> {
    await prisma.outgoingMessage.updateMany({
        where: { id: messageId, status: { in: ['pending', 'error'] } },
        data: {
            status: 'error',
            ...(clearMedia ? { mediaPath: null } : {}),
            updatedAt: new Date(),
        },
    });
}

async function markPendingMessageAsSubmitted(messageId: string): Promise<void> {
    // ACK/NACK can arrive before the HTTP send resolves. Only replace pending
    // so a faster authoritative WhatsApp status is never downgraded.
    await prisma.outgoingMessage.updateMany({
        where: { id: messageId, status: 'pending' },
        data: { status: 'submitted', updatedAt: new Date() },
    });
}

function createMessageIdConflictError(): Error & { code: string; statusCode: number } {
    const error = new Error(
        'ID pesan sudah digunakan untuk permintaan pengiriman yang berbeda.',
    ) as Error & { code: string; statusCode: number };
    error.code = 'MESSAGE_ID_CONFLICT';
    error.statusCode = 409;
    return error;
}

async function reserveInboxOutgoingMessage(params: {
    data: any;
    messageId: string;
    sessionId: string;
    deviceId: number;
    jid: string;
    messageText: string;
    fileName?: string | null;
}): Promise<{ created: boolean; message: any }> {
    try {
        const message = await prisma.outgoingMessage.create({
            data: params.data,
            include: { contact: { select: inboxMessageContactSelect } },
        });
        return { created: true, message };
    } catch (error) {
        if ((error as { code?: unknown })?.code !== 'P2002') throw error;

        // A client keeps the same WhatsApp-compatible ID across an HTTP retry.
        // The unique row is therefore also the idempotency boundary: a second
        // request observes the first result and must never send another stanza.
        const existing = await prisma.outgoingMessage.findUnique({
            where: { id: params.messageId },
            include: { contact: { select: inboxMessageContactSelect } },
        });
        if (!existing) throw error;

        let existingText = '';
        try {
            existingText = String(decryptOutgoingMessage(existing).message || '');
        } catch {
            throw createMessageIdConflictError();
        }

        const sameRequest =
            existing.sessionId === params.sessionId &&
            existing.deviceId === params.deviceId &&
            existing.to === params.jid &&
            existingText === params.messageText &&
            (params.fileName === undefined || existing.fileName === params.fileName);
        if (!sameRequest) throw createMessageIdConflictError();

        return { created: false, message: existing };
    }
}

async function sendQueuedMediaRecipients(params: {
    session: any;
    deviceUuid: string;
    recipients: string[];
    fileData: {
        mimetype?: string;
        buffer?: Buffer;
        newName?: string;
        originalName?: string;
        url?: string;
    };
    mediaType: QueuedMediaType;
    caption?: string;
    delay?: number;
}) {
    const results: { index: number; result?: any }[] = [];
    const errors: { index: number; error: string }[] = [];

    for (let index = 0; index < params.recipients.length; index++) {
        try {
            if (index > 0 && params.delay && params.delay > 0) {
                await delayMs(params.delay);
            }
            const jid = getJid(params.recipients[index]);
            await verifyJid(params.session, jid, jid.includes('@g.us') ? 'group' : 'number');
            const media =
                params.fileData.buffer ??
                (params.fileData.url ? { url: params.fileData.url } : undefined);
            if (!media) throw new Error('Media file tidak tersedia');

            const content: any = {
                [params.mediaType]: media,
                mimetype: params.fileData.mimetype,
                fileName: params.fileData.originalName ?? params.fileData.newName,
                ...(params.caption && params.mediaType !== 'audio'
                    ? { caption: params.caption }
                    : {}),
                ...(params.mediaType === 'audio' ? { ptt: false } : {}),
            };
            const sent = await sendGenericMessage(params.session, params.deviceUuid, jid, content);
            if (!sent.success) throw new Error(sent.error || 'Pengiriman media gagal');
            results.push({ index, result: sent.result });
        } catch (error) {
            const message = error instanceof Error ? error.message : 'Pengiriman media gagal';
            errors.push({ index, error: message });
        }
    }
    return { results, errors };
}

export const sendMessages: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const session = getInstance(sessionId)!;
        if (!session) {
            return res.status(400).json({ message: 'Session not found' });
        }

        const results: { index: number; result?: any; message?: any }[] = [];
        const errors: {
            index: number;
            error: string;
            code?: string;
            statusCode?: number;
        }[] = [];

        // helper: tunggu ms
        const delayMs = (ms: number) => new Promise((r) => setTimeout(r, ms));

        // helper: normalisasi JID grup
        const normalizeGroupJid = (raw: string) => {
            // jika sudah mengandung domain, gunakan apa adanya
            if (raw.includes('@')) return raw;
            // jika format mengandung '-' (mis. 12345-67890) -> tambahkan domain grup
            if (raw.includes('-')) return `${raw}@g.us`;
            // jika hanya angka tanpa '-' kemungkinan user tidak memberikan full id -> return raw (akan divalidasi nanti)
            return `${raw}@g.us`;
        };

        for (const [index, item] of (req.body as any[]).entries()) {
            const {
                recipient,
                type = 'number', // 'number' | 'group'
                delay = 5000,
                message,
                options,
            } = item;

            try {
                if (!recipient) throw new Error('Missing recipient');

                let jid: string;
                if (type === 'group') {
                    jid = normalizeGroupJid(String(recipient));

                    // Relaxed validation: just check if it's a valid @g.us format
                    // Some group JIDs may not have hyphen in newer WhatsApp versions
                    if (!jid.includes('@g.us')) {
                        throw new Error('Invalid group JID. Group JID must end with @g.us domain.');
                    }

                    // Opsional: coba ambil metadata grup jika tersedia untuk memastikan grup ada
                    try {
                        if (typeof (session as any).groupMetadata === 'function') {
                            await (session as any).groupMetadata(jid);
                        } else if (typeof (session as any).fetchGroupMetadata === 'function') {
                            await (session as any).fetchGroupMetadata(jid);
                        }
                    } catch (metaErr) {
                        // jika metadata gagal, jangan langsung crash — berikan pesan yang spesifik
                        throw new Error(
                            `Group not found or inaccessible: ${
                                metaErr instanceof Error ? metaErr.message : String(metaErr)
                            }`,
                        );
                    }
                } else {
                    // number/individual
                    jid = getJid(String(recipient)); // helper yang menambahkan @s.whatsapp.net atau yang sesuai
                }

                // jika ada fungsi verifyJid yang menerima tipe, panggil dengan type; jika tidak, panggil biasa
                try {
                    if (typeof verifyJid === 'function') {
                        // beberapa implementasi verifyJid mungkin menerima (session, jid, type) atau (session, jid)
                        // coba panggilan kompatibel:
                        if (verifyJid.length >= 3) {
                            await verifyJid(session, jid, type);
                        } else {
                            await verifyJid(session, jid);
                        }
                    }
                } catch (vErr) {
                    // berikan pesan yang jelas jika verifikasi gagal
                    throw new Error(
                        `JID verification failed: ${String((vErr as Error).message ?? vErr)}`,
                    );
                }

                // delay antar pesan jika diperlukan
                if (index > 0 && typeof delay === 'number' && delay > 0) {
                    const startTime = Date.now();
                    await delayMs(delay);
                    const endTime = Date.now();
                    logger.info(
                        `Requested delay ${delay}ms; actual elapsed ${
                            endTime - startTime
                        }ms (index ${index})`,
                    );
                }

                // Pastikan payload message kompatibel: jika user mengirim string, ubah ke { text: ... }
                let payload = message;
                if (typeof message === 'string') {
                    payload = { text: message };
                } else if (
                    !message ||
                    (typeof message === 'object' && Object.keys(message).length === 0)
                ) {
                    throw new Error('Empty message payload');
                }

                // Reserve the WhatsApp ID before sending. ACK/NACK events may
                // arrive before sendMessage resolves, so the receipt handler
                // needs a pending row to update first.
                const messageText =
                    typeof payload === 'string'
                        ? payload
                        : payload?.text || JSON.stringify(payload);
                const messageId = createTrackedMessageId(options?.messageId, session?.user?.id);
                const encryptedMessage = encryptMessage(messageText);
                const contactPhone = jid.split('@')[0].replace(/\D/g, '');
                const contact = await prisma.contact.findFirst({
                    where: {
                        phone: { in: [contactPhone, `+${contactPhone}`] },
                        contactDevices: {
                            some: { deviceId: req.authenticatedDevice.deviceId },
                        },
                    },
                    select: { pkId: true },
                });

                const reservation = await reserveInboxOutgoingMessage({
                    messageId,
                    sessionId,
                    deviceId: req.authenticatedDevice.deviceId,
                    jid,
                    messageText,
                    data: {
                        id: messageId,
                        waMessageId: messageId,
                        sessionId,
                        deviceId: req.authenticatedDevice.deviceId,
                        to: jid,
                        message: encryptedMessage,
                        schedule: new Date(),
                        status: 'pending',
                        contactId: contact?.pkId || null,
                        broadcastType: 'inbox',
                        isGroup: type === 'group',
                        readBy: [],
                    },
                });

                if (!reservation.created) {
                    const responseMessage = {
                        ...reservation.message,
                        message: messageText,
                        isOutgoing: true,
                        idempotent: true,
                    };
                    results.push({
                        index,
                        result: {
                            key: {
                                id: reservation.message.waMessageId || reservation.message.id,
                                remoteJid: jid,
                                fromMe: true,
                            },
                            idempotent: true,
                        },
                        message: responseMessage,
                    });
                    continue;
                }

                const queuedResult = await sendGenericMessage(
                    session,
                    (req.authenticatedDevice as any).deviceUuid,
                    jid,
                    payload,
                    { ...(options ?? {}), messageId, persist: false },
                );
                if (!queuedResult.success) {
                    await markPendingMessageAsFailed(messageId);
                    const sendError = new Error(
                        queuedResult.error || 'Failed to send message',
                    ) as Error & { code?: string; statusCode?: number };
                    sendError.code = queuedResult.errorCode;
                    sendError.statusCode = queuedResult.statusCode;
                    throw sendError;
                }

                const result = queuedResult.result;
                const returnedMessageId = result?.key?.id;
                if (returnedMessageId && returnedMessageId !== messageId) {
                    logger.warn(
                        { sessionId, expectedMessageId: messageId, returnedMessageId },
                        'WhatsApp returned a different message ID than the reserved ID',
                    );
                }

                await markPendingMessageAsSubmitted(messageId);

                // A fast NACK may already have changed pending to error. Re-read
                // and return that truth. `submitted` confirms only local stanza
                // handoff; server_ack still requires a WhatsApp status event.
                const savedMessage = await prisma.outgoingMessage.findUnique({
                    where: { id: messageId },
                    include: { contact: { select: inboxMessageContactSelect } },
                });
                if (!savedMessage) {
                    throw new Error('Pesan keluar tidak ditemukan setelah dikirim');
                }

                const responseMessage = {
                    ...savedMessage,
                    message: messageText,
                    isOutgoing: true,
                };
                getSocketIO()
                    .to(`session:${sessionId}`)
                    .emit(`outgoing:${sessionId}`, responseMessage);
                results.push({ index, result, message: responseMessage });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error(e, `Failed to send message at index ${index}: ${msg}`);
                const typedError = e as { code?: unknown; statusCode?: unknown };
                errors.push({
                    index,
                    error: msg,
                    code: typeof typedError.code === 'string' ? typedError.code : undefined,
                    statusCode:
                        typeof typedError.statusCode === 'number'
                            ? typedError.statusCode
                            : undefined,
                });
            }
        }

        const controlledStatus = errors[0]?.statusCode;
        const allErrorsShareControlledStatus =
            errors.length > 0 &&
            typeof controlledStatus === 'number' &&
            [409, 423, 503].includes(controlledStatus) &&
            errors.every((error) => error.statusCode === controlledStatus);
        res.status(
            errors.length > 0 ? (allErrorsShareControlledStatus ? controlledStatus : 500) : 200,
        ).json({
            ...(errors.length > 0 ? { message: errors[0].error } : {}),
            results,
            errors,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const sendImageMessages: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const session = getInstance(sessionId)!;

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        memoryUpload.single('image')(req, res, async (err) => {
            if (err) {
                const message = 'An error occurred during file upload';
                logger.error(err, message);
                return res.status(500).json({ error: message });
            }

            const recipients: string[] = req.body.recipients || [];

            if (!recipients.length) {
                return res.status(400).json({ error: 'Recipient JIDs are required' });
            }

            const fileData = {
                mimetype: req.file?.mimetype,
                buffer: req.file?.buffer,
                newName: req.file?.filename,
                originalName: req.file?.originalname,
                url: req.file?.path,
            };

            const fileType = 'image';
            const caption = req.body.caption || '';
            const delay = req.body.delay || 5000;

            const { results, errors } = await sendQueuedMediaRecipients({
                session,
                deviceUuid: (req.authenticatedDevice as any).deviceUuid,
                recipients,
                fileData: fileData as any,
                mediaType: fileType,
                caption,
                delay: Number(delay),
            });

            res.status(errors.length > 0 ? 500 : 200).json({
                results,
                errors,
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const sendDocumentMessages: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const session = getInstance(sessionId)!;

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        memoryUpload.single('document')(req, res, async (err) => {
            if (err) {
                const message = 'An error occurred during file upload';
                logger.error(err, message);
                return res.status(500).json({ error: message });
            }

            const recipients: string[] = req.body.recipients || [];

            if (!recipients.length) {
                return res.status(400).json({ error: 'Recipient JIDs are required' });
            }

            const fileData = {
                mimetype: req.file?.mimetype,
                buffer: req.file?.buffer,
                newName: req.file?.filename,
                originalName: req.file?.originalname,
                url: req.file?.path,
            };

            // logger.warn(fileData);
            const fileType = 'document';
            const caption = req.body.caption || '';
            const delay = req.body.delay || 5000;

            const { results, errors } = await sendQueuedMediaRecipients({
                session,
                deviceUuid: (req.authenticatedDevice as any).deviceUuid,
                recipients,
                fileData: fileData as any,
                mediaType: fileType,
                caption,
                delay: Number(delay),
            });

            res.status(errors.length > 0 ? 500 : 200).json({
                results,
                errors,
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const sendAudioMessages: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const session = getInstance(sessionId)!;

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        memoryUpload.single('audio')(req, res, async (err) => {
            if (err) {
                const message = 'An error occurred during file upload';
                logger.error(err, message);
                return res.status(500).json({ error: message });
            }

            const recipients: string[] = req.body.recipients || [];

            if (!recipients.length) {
                return res.status(400).json({ error: 'Recipient JIDs are required' });
            }

            const fileData = {
                mimetype: req.file?.mimetype,
                buffer: req.file?.buffer,
                newName: req.file?.filename,
                originalName: req.file?.originalname,
                url: req.file?.path,
            };

            const fileType = 'audio';
            const caption = req.body.caption || '';
            const delay = req.body.delay || 5000;

            const { results, errors } = await sendQueuedMediaRecipients({
                session,
                deviceUuid: (req.authenticatedDevice as any).deviceUuid,
                recipients,
                fileData: fileData as any,
                mediaType: fileType,
                caption,
                delay: Number(delay),
            });

            res.status(errors.length > 0 ? 500 : 200).json({
                results,
                errors,
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const sendVideoMessages: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const session = getInstance(sessionId)!;

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        memoryUpload.single('video')(req, res, async (err) => {
            if (err) {
                const message = 'An error occurred during file upload';
                logger.error(err, message);
                return res.status(500).json({ error: message });
            }

            const recipients: string[] = req.body.recipients || [];

            if (!recipients.length) {
                return res.status(400).json({ error: 'Recipient JIDs are required' });
            }

            const fileData = {
                mimetype: req.file?.mimetype,
                buffer: req.file?.buffer,
                newName: req.file?.filename,
                originalName: req.file?.originalname,
                url: req.file?.path,
            };

            const fileType = 'video';
            const caption = req.body.caption || '';
            const delay = req.body.delay || 5000;

            const { results, errors } = await sendQueuedMediaRecipients({
                session,
                deviceUuid: (req.authenticatedDevice as any).deviceUuid,
                recipients,
                fileData: fileData as any,
                mediaType: fileType,
                caption,
                delay: Number(delay),
            });

            res.status(errors.length > 0 ? 500 : 200).json({
                results,
                errors,
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Send one media attachment from the Inbox reply composer and persist it in
 * OutgoingMessage so the attachment remains visible after refresh.
 */
export const sendInboxMediaMessage: RequestHandler = async (req, res) => {
    diskUpload.single('media')(req, res, async (uploadError) => {
        if (uploadError) {
            logger.warn({ uploadError }, 'Inbox media upload rejected');
            return res.status(400).json({
                message: uploadError instanceof Error ? uploadError.message : 'Upload media gagal',
            });
        }

        const uploadedPath = req.file?.path;
        let trackedMessageId: string | undefined;
        let reservationOwned = false;
        let sendAccepted = false;
        try {
            const sessionId = req.authenticatedDevice.sessionId;
            const devicePkId = req.authenticatedDevice.deviceId;
            const session = getInstance(sessionId);
            if (!isUUID(sessionId) || !session) {
                throw new Error('Session WhatsApp tidak ditemukan atau tidak terhubung');
            }

            const recipient = typeof req.body.recipient === 'string' ? req.body.recipient : '';
            if (!recipient || !req.file) {
                return res.status(400).json({ message: 'Nomor tujuan dan file media wajib diisi' });
            }

            const jid = getJid(recipient);
            const isGroup = jid.includes('@g.us');
            await verifyJid(session, jid, isGroup ? 'group' : 'number');

            const mimeType = req.file.mimetype;
            const mediaType = mimeType.startsWith('image/')
                ? 'image'
                : mimeType.startsWith('video/')
                ? 'video'
                : mimeType.startsWith('audio/')
                ? 'audio'
                : 'document';
            const caption = typeof req.body.caption === 'string' ? req.body.caption.trim() : '';
            const localMedia = { url: path.resolve(req.file.path) };
            const payload: any = {
                [mediaType]: localMedia,
                mimetype: mimeType,
                fileName: req.file.originalname,
                ...(caption && mediaType !== 'audio' ? { caption } : {}),
                ...(mediaType === 'audio' ? { ptt: false } : {}),
            };

            const placeholders: Record<string, string> = {
                image: '[Gambar]',
                video: '[Video]',
                audio: '[Audio]',
                document: req.file.originalname || '[Dokumen]',
            };
            const messageText = caption || placeholders[mediaType];
            const contactPhone = jid.split('@')[0].replace(/\D/g, '');
            const contact = await prisma.contact.findFirst({
                where: {
                    phone: { in: [contactPhone, `+${contactPhone}`] },
                    contactDevices: { some: { deviceId: devicePkId } },
                },
                select: { pkId: true },
            });
            const mediaPath = req.file.path.replace(/\\/g, '/');
            const messageId = createTrackedMessageId(req.body.messageId, session?.user?.id);
            trackedMessageId = messageId;
            const reservation = await reserveInboxOutgoingMessage({
                messageId,
                sessionId,
                deviceId: devicePkId,
                jid,
                messageText,
                fileName: req.file.originalname,
                data: {
                    id: messageId,
                    waMessageId: messageId,
                    to: jid,
                    message: encryptMessage(messageText),
                    mediaPath,
                    fileName: req.file.originalname,
                    schedule: new Date(),
                    status: 'pending',
                    sessionId,
                    deviceId: devicePkId,
                    contactId: contact?.pkId || null,
                    broadcastType: 'inbox',
                    isGroup,
                    readBy: [],
                },
            });

            if (!reservation.created) {
                // Multer has already materialized the retried upload. The first
                // request owns its original media path, so remove only this
                // redundant retry file.
                if (mediaPath !== reservation.message.mediaPath) {
                    await fs.promises.unlink(req.file.path).catch(() => undefined);
                }
                sendAccepted = true;
                const responseMessage = {
                    ...reservation.message,
                    message: messageText,
                    mediaType,
                    isOutgoing: true,
                    idempotent: true,
                };
                return res.status(200).json({
                    result: {
                        key: {
                            id: reservation.message.waMessageId || reservation.message.id,
                            remoteJid: jid,
                            fromMe: true,
                        },
                        idempotent: true,
                    },
                    message: responseMessage,
                });
            }
            reservationOwned = true;

            const queuedResult = await sendGenericMessage(
                session,
                (req.authenticatedDevice as any).deviceUuid,
                jid,
                payload,
                { messageId, persist: false },
            );
            if (!queuedResult.success) {
                await markPendingMessageAsFailed(messageId, true);
                const sendError = new Error(
                    queuedResult.error || 'Pengiriman media gagal',
                ) as Error & { code?: string; statusCode?: number };
                sendError.code = queuedResult.errorCode;
                sendError.statusCode = queuedResult.statusCode;
                throw sendError;
            }
            sendAccepted = true;
            const result = queuedResult.result;
            const returnedMessageId = result?.key?.id;
            if (returnedMessageId && returnedMessageId !== messageId) {
                logger.warn(
                    { sessionId, expectedMessageId: messageId, returnedMessageId },
                    'WhatsApp returned a different media message ID than the reserved ID',
                );
            }

            await markPendingMessageAsSubmitted(messageId);

            const savedMessage = await prisma.outgoingMessage.findUnique({
                where: { id: messageId },
                include: { contact: { select: inboxMessageContactSelect } },
            });
            if (!savedMessage) {
                throw new Error('Pesan media keluar tidak ditemukan setelah dikirim');
            }

            const responseMessage = {
                ...savedMessage,
                message: messageText,
                mediaType,
                isOutgoing: true,
            };
            getSocketIO().to(`session:${sessionId}`).emit(`outgoing:${sessionId}`, responseMessage);
            return res.status(200).json({ result, message: responseMessage });
        } catch (error) {
            if (trackedMessageId && reservationOwned && !sendAccepted) {
                await markPendingMessageAsFailed(trackedMessageId, true).catch((markError) => {
                    logger.error(
                        { error: markError, messageId: trackedMessageId },
                        'Failed to mark media message as error',
                    );
                });
            }
            if (uploadedPath && !sendAccepted) {
                fs.promises.unlink(uploadedPath).catch(() => {});
            }
            logger.error({ error }, 'Failed to send Inbox media message');
            const typedError = error as { code?: unknown; statusCode?: unknown };
            const statusCode =
                typeof typedError.statusCode === 'number' ? typedError.statusCode : 500;
            return res.status(statusCode).json({
                message: error instanceof Error ? error.message : 'Gagal mengirim media',
                ...(typeof typedError.code === 'string' ? { code: typedError.code } : {}),
            });
        }
    });
};

const isSupportedReactionEmoji = (emoji: string): boolean => {
    if (!emoji || Buffer.byteLength(emoji, 'utf8') > 64) return false;

    const remaining = emoji.replace(
        /[\p{Extended_Pictographic}\p{Regional_Indicator}\p{Emoji_Modifier}\uFE0F\u200D]/gu,
        '',
    );
    if (remaining) return false;

    const pictographs = emoji.match(/\p{Extended_Pictographic}/gu) || [];
    const regionalIndicators = emoji.match(/\p{Regional_Indicator}/gu) || [];

    // One pictograph, a skin-tone variant, a ZWJ-composed emoji, or one flag.
    return (
        (pictographs.length === 1 && regionalIndicators.length === 0) ||
        (pictographs.length > 1 && emoji.includes('\u200D')) ||
        (pictographs.length === 0 && regionalIndicators.length === 2)
    );
};

/**
 * Send or remove the authenticated WhatsApp account's reaction to one Inbox
 * message. The conversation and participant are resolved from persisted data,
 * not trusted from the browser request.
 */
export const sendInboxReaction: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const devicePkId = req.authenticatedDevice.deviceId;
        const targetMessageId =
            typeof req.body.targetMessageId === 'string' ? req.body.targetMessageId.trim() : '';
        const targetFromMe = req.body.targetFromMe;
        const emoji = typeof req.body.emoji === 'string' ? req.body.emoji.trim() : '';

        if (!isUUID(sessionId) || !targetMessageId || typeof targetFromMe !== 'boolean') {
            return res.status(400).json({ message: 'Data pesan reaction tidak valid' });
        }
        if (emoji && !isSupportedReactionEmoji(emoji)) {
            return res.status(400).json({ message: 'Emoji reaction tidak didukung' });
        }

        const session = getInstance(sessionId);
        if (!session?.user) {
            return res.status(409).json({ message: 'Device WhatsApp belum terhubung' });
        }

        let conversationJid: string;
        let whatsappMessageJid: string | null = null;
        let whatsappTargetId: string;
        let participant: string | null = null;

        if (targetFromMe) {
            const target = await prisma.outgoingMessage.findFirst({
                where: {
                    deviceId: devicePkId,
                    OR: [{ waMessageId: targetMessageId }, { id: targetMessageId }],
                },
                select: { id: true, waMessageId: true, to: true },
            });
            if (!target) {
                return res.status(404).json({ message: 'Pesan keluar tidak ditemukan' });
            }
            conversationJid = target.to;
            whatsappTargetId = target.waMessageId || target.id;
            const rawTarget = await prisma.message.findFirst({
                where: { sessionId, id: whatsappTargetId },
                select: { remoteJid: true },
            });
            whatsappMessageJid = rawTarget?.remoteJid || null;
        } else {
            const target = await prisma.incomingMessage.findFirst({
                where: { deviceId: devicePkId, id: targetMessageId },
                select: { id: true, from: true, participant: true },
            });
            if (!target) {
                return res.status(404).json({ message: 'Pesan masuk tidak ditemukan' });
            }
            conversationJid = target.from;
            whatsappTargetId = target.id;
            participant = target.participant;
        }

        const jid = conversationJid.includes('@') ? conversationJid : getJid(conversationJid);
        const deliveryJid = whatsappMessageJid || jid;
        const targetKey = {
            remoteJid: deliveryJid,
            id: whatsappTargetId,
            fromMe: targetFromMe,
            ...(deliveryJid.endsWith('@g.us') && participant ? { participant } : {}),
        };
        const queuedReaction = await sendGenericMessage(
            session,
            (req.authenticatedDevice as any).deviceUuid,
            deliveryJid,
            { react: { text: emoji, key: targetKey } },
            { persist: false, trackHealth: false },
        );
        if (!queuedReaction.success) {
            throw new Error(queuedReaction.error || 'Gagal mengirim reaction');
        }
        const result = queuedReaction.result;

        const reaction = await saveMessageReaction({
            deviceId: devicePkId,
            sessionId,
            conversationJid: jid,
            targetMessageId: whatsappTargetId,
            targetFromMe,
            reactorJid: 'me',
            emoji,
            reactionMessageId: result?.key?.id || null,
            reactedAt: new Date(),
        });
        const event = { ...reaction, conversationJid: jid };
        getSocketIO().to(`session:${sessionId}`).emit(`reaction:${sessionId}`, event);

        return res.status(200).json({ success: true, reaction: event });
    } catch (error) {
        logger.warn({ code: (error as { code?: unknown })?.code }, 'Failed to send Inbox reaction');
        return res.status(500).json({
            message: 'Gagal memproses reaction WhatsApp. Silakan muat ulang dan coba kembali.',
        });
    }
};

/**
 * Delete one persisted Inbox message for the current account, or revoke an
 * outgoing message for everyone. Target ownership is resolved server-side.
 */
export const deleteInboxMessage: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const devicePkId = req.authenticatedDevice.deviceId;
        const targetMessageId =
            typeof req.body.targetMessageId === 'string' ? req.body.targetMessageId.trim() : '';
        const targetFromMe = req.body.targetFromMe;
        const scope = req.body.scope;

        if (
            !isUUID(sessionId) ||
            !targetMessageId ||
            typeof targetFromMe !== 'boolean' ||
            !['me', 'everyone'].includes(scope)
        ) {
            return res.status(400).json({ message: 'Data penghapusan pesan tidak valid' });
        }
        if (scope === 'everyone' && !targetFromMe) {
            return res.status(400).json({
                message: 'Hanya pesan yang Anda kirim yang dapat dihapus untuk semua',
            });
        }

        const session = getInstance(sessionId);
        if (scope === 'everyone' && !session?.user) {
            return res.status(409).json({ message: 'Device WhatsApp belum terhubung' });
        }

        let conversationJid: string;
        let whatsappTargetId: string;
        let participant: string | null = null;
        let messageTimestamp: Date;
        let targetPkId: number;
        let targetMediaPath: string | null = null;

        if (targetFromMe) {
            const target = await prisma.outgoingMessage.findFirst({
                where: {
                    deviceId: devicePkId,
                    OR: [{ waMessageId: targetMessageId }, { id: targetMessageId }],
                },
                select: {
                    pkId: true,
                    id: true,
                    waMessageId: true,
                    to: true,
                    createdAt: true,
                    mediaPath: true,
                },
            });
            if (!target) {
                return res.status(404).json({ message: 'Pesan keluar tidak ditemukan' });
            }
            conversationJid = target.to;
            whatsappTargetId = target.waMessageId || target.id;
            messageTimestamp = target.createdAt;
            targetPkId = target.pkId;
            targetMediaPath = target.mediaPath;
        } else {
            const target = await prisma.incomingMessage.findFirst({
                where: { deviceId: devicePkId, id: targetMessageId },
                select: {
                    pkId: true,
                    id: true,
                    from: true,
                    participant: true,
                    receivedAt: true,
                    mediaPath: true,
                },
            });
            if (!target) {
                return res.status(404).json({ message: 'Pesan masuk tidak ditemukan' });
            }
            conversationJid = target.from;
            whatsappTargetId = target.id;
            participant = target.participant;
            messageTimestamp = target.receivedAt;
            targetPkId = target.pkId;
            targetMediaPath = target.mediaPath;
        }

        const jid = conversationJid.includes('@') ? conversationJid : getJid(conversationJid);
        const key = {
            remoteJid: jid,
            id: whatsappTargetId,
            fromMe: targetFromMe,
            ...(jid.endsWith('@g.us') && participant ? { participant } : {}),
        };

        let whatsappSynced = true;
        if (scope === 'everyone') {
            const queuedDelete = await sendGenericMessage(
                session,
                (req.authenticatedDevice as any).deviceUuid,
                jid,
                { delete: key },
                { persist: false, trackHealth: false },
            );
            if (!queuedDelete.success) {
                throw new Error(queuedDelete.error || 'Gagal menghapus pesan untuk semua');
            }
        } else if (session?.user) {
            try {
                await session.chatModify(
                    {
                        deleteForMe: {
                            deleteMedia: true,
                            key,
                            timestamp: Math.floor(messageTimestamp.getTime() / 1000),
                        },
                    },
                    jid,
                );
            } catch (error) {
                // WhatsApp's delete-for-me uses App State Sync. A freshly linked
                // or partially restored session may not have that key yet. The
                // Inbox remains authoritative for this local action, so do not
                // make a missing WhatsApp sync key block the database deletion.
                whatsappSynced = false;
                logger.warn(
                    { code: (error as { code?: unknown })?.code },
                    'WhatsApp delete-for-me sync unavailable; continuing with Inbox deletion',
                );
            }
        } else {
            whatsappSynced = false;
        }

        if (targetFromMe && scope === 'everyone') {
            await prisma.outgoingMessage.update({
                where: { pkId: targetPkId },
                data: {
                    message: encryptMessage('Pesan ini telah dihapus'),
                    mediaPath: null,
                    status: 'revoked',
                    updatedAt: new Date(),
                },
            });
        } else if (targetFromMe) {
            await prisma.outgoingMessage.delete({ where: { pkId: targetPkId } });
        } else {
            await prisma.incomingMessage.delete({ where: { pkId: targetPkId } });
        }
        await deleteMessageReactions(devicePkId, sessionId, whatsappTargetId).catch((error) => {
            logger.warn(
                { code: (error as { code?: unknown })?.code },
                'Failed to delete reaction metadata for deleted message',
            );
        });
        const mediaCleanup = await cleanupMediaFilesIfUnreferenced(
            [targetMediaPath],
            `delete-inbox-message:${scope}`,
        );

        const event = {
            targetMessageId: whatsappTargetId,
            targetFromMe,
            conversationJid: jid,
            scope,
            placeholder: scope === 'everyone' ? 'Pesan ini telah dihapus' : null,
            whatsappSynced,
        };
        getSocketIO().to(`session:${sessionId}`).emit(`message-deleted:${sessionId}`, event);

        return res.status(200).json({
            success: true,
            deleted: event,
            mediaCleanup: {
                deleted: mediaCleanup.deleted,
                retainedBecauseReferenced: mediaCleanup.referenced,
                failed: mediaCleanup.failed,
            },
        });
    } catch (error) {
        logger.warn(
            { code: (error as { code?: unknown })?.code },
            'Failed to delete Inbox message',
        );
        return res.status(500).json({
            message: error instanceof Error ? error.message : 'Gagal menghapus pesan WhatsApp',
        });
    }
};

export const sendButton: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const session = getInstance(sessionId)!;
        const to = req.body.to;
        const data = req.body.data;

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const result = await sendButtonMessage(session, to, data);

        res.status(200).json({ success: true, result });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { cursor = undefined, limit = 25 } = req.query;
        const messages = (
            await prisma.message.findMany({
                cursor: cursor ? { pkId: Number(cursor) } : undefined,
                take: Number(limit),
                skip: cursor ? 1 : 0,
                where: { sessionId },
            })
        ).map((m) => serializePrisma(m));

        res.status(200).json({
            data: messages,
            cursor:
                messages.length !== 0 && messages.length === Number(limit)
                    ? messages[messages.length - 1].pkId
                    : null,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getIncomingMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { page = 1, pageSize = 25, phoneNumber, message, contactName } = req.query;
        const offset = (Number(page) - 1) * Number(pageSize);

        const messages = (
            await prisma.incomingMessage.findMany({
                take: Number(pageSize),
                skip: offset,
                where: {
                    sessionId,
                    from: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                    message: {
                        contains: message ? message.toString() : undefined,
                        mode: 'insensitive',
                    },
                    contact: {
                        OR: contactName
                            ? [
                                  {
                                      firstName: {
                                          contains: contactName.toString(),
                                          mode: 'insensitive',
                                      },
                                  },
                                  {
                                      lastName: {
                                          contains: contactName.toString(),
                                          mode: 'insensitive',
                                      },
                                  },
                              ]
                            : undefined,
                    },
                },
                include: {
                    contact: {
                        select: { firstName: true, lastName: true, colorCode: true },
                    },
                },
                orderBy: { updatedAt: 'desc' },
            })
        ).map((m) => serializePrisma(decryptIncomingMessage(m)));

        const totalMessages = await prisma.incomingMessage.count({
            where: {
                sessionId,
                from: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                message: {
                    contains: message ? message.toString() : undefined,
                    mode: 'insensitive',
                },
                contact: {
                    OR: contactName
                        ? [
                              {
                                  firstName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                              {
                                  lastName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                          ]
                        : undefined,
                },
            },
        });

        const currentPage = Math.max(1, Number(page) || 1);
        const totalPages = Math.ceil(totalMessages / Number(pageSize));
        const hasMore = currentPage * Number(pageSize) < totalMessages;

        res.status(200).json({
            data: messages,
            metadata: {
                totalMessages,
                currentPage,
                totalPages,
                hasMore,
            },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getOutgoingMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { page = 1, pageSize = 25, phoneNumber, message, contactName } = req.query;
        const offset = (Number(page) - 1) * Number(pageSize);

        const messages = (
            await prisma.outgoingMessage.findMany({
                take: Number(pageSize),
                skip: offset,
                where: {
                    sessionId,
                    to: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                    message: {
                        contains: message ? message.toString() : undefined,
                        mode: 'insensitive',
                    },
                    contact: {
                        OR: contactName
                            ? [
                                  {
                                      firstName: {
                                          contains: contactName.toString(),
                                          mode: 'insensitive',
                                      },
                                  },
                                  {
                                      lastName: {
                                          contains: contactName.toString(),
                                          mode: 'insensitive',
                                      },
                                  },
                              ]
                            : undefined,
                    },
                },
                include: {
                    contact: {
                        select: { firstName: true, lastName: true, colorCode: true },
                    },
                },
                orderBy: { updatedAt: 'desc' },
            })
        ).map((m) => serializePrisma(m));

        const totalMessages = await prisma.outgoingMessage.count({
            where: {
                sessionId,
                to: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                message: {
                    contains: message ? message.toString() : undefined,
                    mode: 'insensitive',
                },
                contact: {
                    OR: contactName
                        ? [
                              {
                                  firstName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                              {
                                  lastName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                          ]
                        : undefined,
                },
            },
        });

        const currentPage = Math.max(1, Number(page) || 1);
        const totalPages = Math.ceil(totalMessages / Number(pageSize));
        const hasMore = currentPage * Number(pageSize) < totalMessages;

        res.status(200).json({
            data: messages,
            metadata: {
                totalMessages,
                currentPage,
                totalPages,
                hasMore,
            },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: fix resource-intensive queries
export const getConversationMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { page = 1, pageSize = 25, phoneNumber, message, contactName } = req.query;
        const sort = req.query.sort as string;
        const offset = (Number(page) - 1) * Number(pageSize);

        const incomingMessages = await prisma.incomingMessage.findMany({
            where: {
                sessionId,
                from: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                message: {
                    contains: message ? message.toString() : undefined,
                    mode: 'insensitive',
                },
                contact: {
                    OR: contactName
                        ? [
                              {
                                  firstName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                              {
                                  lastName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                          ]
                        : undefined,
                },
            },
            include: {
                contact: {
                    select: { firstName: true, lastName: true, colorCode: true },
                },
            },
        });

        const outgoingMessages = await prisma.outgoingMessage.findMany({
            where: {
                sessionId,
                to: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                message: {
                    contains: message ? message.toString() : undefined,
                    mode: 'insensitive',
                },
                contact: {
                    OR: contactName
                        ? [
                              {
                                  firstName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                              {
                                  lastName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                          ]
                        : undefined,
                },
            },
            include: {
                contact: {
                    select: { firstName: true, lastName: true, colorCode: true },
                },
            },
        });

        // Combine incoming and outgoing messages into one array
        const allMessages = [...incomingMessages, ...outgoingMessages];
        logger.debug(allMessages);

        // Sort the combined messages by timestamp (receivedAt or createdAt)
        sort == 'asc'
            ? allMessages.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            : allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        // Apply pagination
        const messages = allMessages.slice(offset, offset + Number(pageSize));

        const totalMessages = incomingMessages.length + outgoingMessages.length;
        const currentPage = Math.max(1, Number(page) || 1);
        const totalPages = Math.ceil(totalMessages / Number(pageSize));
        const hasMore = currentPage * Number(pageSize) < totalMessages;

        // Decrypt messages before returning
        const decryptedMessages = messages.map((m) =>
            'from' in m ? decryptIncomingMessage(m) : decryptOutgoingMessage(m),
        );

        res.status(200).json({
            data: decryptedMessages.map((m) => serializePrisma(m)),
            metadata: {
                totalMessages,
                currentPage,
                totalPages,
                hasMore,
            },
        });
    } catch (e) {
        const message = 'An error occurred during message list';
        logger.error(e, message);
        res.status(500).json({ error: message });
    }
};

export const getMessengerList: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { page = 1, pageSize = 25 } = req.query;
        const sort = req.query.sort as string;
        const offset = (Number(page) - 1) * Number(pageSize);

        const incomingMessages = await prisma.incomingMessage.findMany({
            where: {
                sessionId,
                NOT: { from: { contains: '@g.us' } },
            },
            select: { from: true, createdAt: true, contact: true },
        });

        const outgoingMessages = await prisma.outgoingMessage.findMany({
            where: {
                sessionId,
                NOT: { to: { contains: '@g.us' } },
            },
            select: { to: true, createdAt: true, contact: true },
        });

        type Message = {
            from?: string;
            createdAt: Date;
            contact?: unknown;
            to?: string;
            phone?: string;
        };

        // Combine incoming and outgoing messages into one array
        const allMessages: Message[] = [...incomingMessages, ...outgoingMessages];
        for (const message of allMessages) {
            if ('from' in message) {
                message.phone = message.from;
                delete message.from;
            } else if ('to' in message) {
                message.phone = message.to;
                delete message.to;
            }
        }
        logger.debug(allMessages);

        // Sort the combined messages by timestamp (receivedAt or createdAt)
        sort == 'asc'
            ? allMessages.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            : allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        // Create a map to track unique recipients and their most recent timestamps
        const uniqueRecipients = new Map();

        for (const message of allMessages) {
            const { createdAt, phone, contact } = message;

            // Incoming message
            if (!uniqueRecipients.has(phone) || uniqueRecipients.get(phone).createdAt < createdAt) {
                uniqueRecipients.set(phone, { createdAt, contact });
            }
        }

        // Convert the map back to an array of objects
        const uniqueMessages = Array.from(uniqueRecipients, ([key, value]) => ({
            phone: key.split('@')[0],
            createdAt: value.createdAt,
            contact: value.contact,
        }));

        // Apply pagination
        const messages = uniqueMessages.slice(offset, offset + Number(pageSize));

        const totalMessages = incomingMessages.length + outgoingMessages.length;
        const currentPage = Math.max(1, Number(page) || 1);
        const totalPages = Math.ceil(totalMessages / Number(pageSize));
        const hasMore = currentPage * Number(pageSize) < totalMessages;

        res.status(200).json({
            data: messages.map((m) => serializePrisma(m)),
            metadata: {
                totalMessages,
                currentPage,
                totalPages,
                hasMore,
            },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// Parity with front-end message controller: additional utilities
export const getStatusOutgoingMessagesById: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { messageId } = req.params as { messageId: string };
        const message = await prisma.outgoingMessage.findFirst({
            where: { sessionId, id: messageId },
            select: { status: true },
        });

        if (!message) {
            return res.status(404).json({ message: 'Message not found' });
        }

        res.status(200).json(serializePrisma(message));
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getProfilePictureUrl: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });

        const { recipient, resolution, download } = req.query as {
            recipient?: string;
            resolution?: string;
            download?: string;
        };
        if (!recipient) return res.status(400).json({ message: 'Recipient is required' });

        // Support untuk 'me' - ambil nomor phone dari database
        let jid: string;
        if (recipient.toLowerCase() === 'me') {
            // Ambil nomor phone dari database Session -> Device
            const sessionData = await prisma.session.findFirst({
                where: { sessionId },
                include: { device: { select: { phone: true } } },
            });

            if (!sessionData?.device?.phone) {
                return res.status(400).json({ message: 'Phone number not found for this session' });
            }

            jid = getJid(sessionData.device.phone);
        } else if (recipient.includes('@g.us')) {
            jid = recipient;
        } else {
            jid = getJid(recipient);
        }

        let ppUrl: string | undefined;
        try {
            ppUrl = await session.profilePictureUrl(
                jid,
                resolution === 'high' ? 'image' : undefined,
            );
        } catch (highResolutionError) {
            if (resolution !== 'high') {
                logger.debug({ jid }, 'Profile picture is not available');
                return res.status(204).send();
            }
            try {
                // Some accounts expose only the preview-sized profile photo.
                ppUrl = await session.profilePictureUrl(jid);
            } catch {
                logger.debug({ jid }, 'Profile picture is not available');
                return res.status(204).send();
            }
        }
        if (!ppUrl) {
            return res.status(204).send();
        }

        if (download === '1' || download === 'true') {
            const cacheKey = `${sessionId}:${jid}:${resolution || 'preview'}`;
            const cached = profilePictureCache.get(cacheKey);

            if (cached && cached.expiresAt > Date.now()) {
                res.setHeader('Content-Type', cached.contentType);
                res.setHeader('Cache-Control', 'private, max-age=300');
                return res.status(200).send(cached.data);
            }

            const pictureResponse = await axios.get<Buffer>(ppUrl, {
                responseType: 'arraybuffer',
                timeout: 15_000,
                maxContentLength: PROFILE_PICTURE_MAX_BYTES,
                maxBodyLength: PROFILE_PICTURE_MAX_BYTES,
                httpsAgent: profilePictureHttpsAgent,
                headers: {
                    Accept: 'image/*',
                    'User-Agent': 'Mozilla/5.0',
                },
            });
            const data = pictureResponse.data;
            if (data.length > PROFILE_PICTURE_MAX_BYTES) {
                return res.status(413).json({ message: 'Profile picture is too large' });
            }

            const rawContentType = pictureResponse.headers['content-type'];
            const contentType =
                typeof rawContentType === 'string' && rawContentType.startsWith('image/')
                    ? rawContentType
                    : 'image/jpeg';
            profilePictureCache.set(cacheKey, {
                data,
                contentType,
                expiresAt: Date.now() + PROFILE_PICTURE_CACHE_TTL_MS,
            });

            res.setHeader('Content-Type', contentType);
            res.setHeader('Cache-Control', 'private, max-age=300');
            return res.status(200).send(data);
        }

        res.status(200).json({ profilePictureUrl: ppUrl });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBusinessProfile: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });

        const { contactId } = req.query as { contactId?: string };
        if (!contactId)
            return res.status(400).json({ message: 'contactId query parameter is required' });

        const profile = await session.getBusinessProfile(contactId);
        if (!profile) return res.status(404).json({ message: 'Business profile not found' });

        res.status(200).json({ description: profile.description, category: profile.category });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteMessagesForEveryone: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const results: { index: number; result?: any }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [index, { recipient, deleteMessageKey }] of (req.body as any[]).entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, 'number');

                if (deleteMessageKey && deleteMessageKey.id) {
                    const key = { remoteJid: jid, id: deleteMessageKey.id, fromMe: true } as any;
                    const queuedDelete = await sendGenericMessage(
                        session,
                        (req.authenticatedDevice as any).deviceUuid,
                        jid,
                        { delete: key },
                        { persist: false, trackHealth: false },
                    );
                    if (!queuedDelete.success) {
                        throw new Error(queuedDelete.error || 'Gagal menghapus pesan');
                    }
                    const deleteMessageResult = queuedDelete.result;
                    results.push({ index, result: deleteMessageResult });
                    await prisma.outgoingMessage.deleteMany({
                        where: { sessionId, id: deleteMessageKey.id },
                    });
                } else {
                    throw new Error('deleteMessageKey with id is required to delete a message');
                }
            } catch (e) {
                const msg =
                    e instanceof Error ? e.message : 'An error occurred during message delete';
                logger.error(e, msg);
                errors.push({ index, error: msg });
            }
        }

        res.status(errors.length > 0 ? 500 : 200).json({ results, errors });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteMessagesForMe: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const results: { index: number; result?: any }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [index, { recipient, deleteMessageKey }] of (req.body as any[]).entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, 'number');

                if (deleteMessageKey && deleteMessageKey.id) {
                    const key = {
                        id: deleteMessageKey.id,
                        fromMe: true,
                        timestamp: Date.now(),
                    } as any;
                    const deleteMessageResult = await session.chatModify(
                        { clear: { messages: [key] } } as any,
                        jid,
                    );
                    results.push({ index, result: deleteMessageResult });
                } else {
                    throw new Error(
                        'deleteMessageKey with id is required to delete a message for self',
                    );
                }
            } catch (e) {
                const msg =
                    e instanceof Error ? e.message : 'An error occurred during message delete';
                logger.error(e, msg);
                errors.push({ index, error: msg });
            }
        }

        res.status(errors.length > 0 ? 500 : 200).json({ results, errors });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateMessage: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const results: { index: number; result?: any }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [index, { recipient, messageId, newText }] of (req.body as any[]).entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, 'number');

                if (messageId) {
                    const key = { remoteJid: jid, id: messageId, fromMe: true } as any;
                    const queuedEdit = await sendGenericMessage(
                        session,
                        (req.authenticatedDevice as any).deviceUuid,
                        jid,
                        { text: newText, edit: key },
                        { persist: false, trackHealth: false },
                    );
                    if (!queuedEdit.success) {
                        throw new Error(queuedEdit.error || 'Gagal mengubah pesan');
                    }
                    const updateMessageResult = queuedEdit.result;
                    results.push({ index, result: updateMessageResult });
                    await prisma.outgoingMessage.update({
                        where: { sessionId: sessionId, id: messageId } as any,
                        data: { message: encryptMessage(newText) },
                    });
                } else {
                    throw new Error('messageId is required to update a message');
                }
            } catch (e) {
                const msg =
                    e instanceof Error ? e.message : 'An error occurred during message update';
                logger.error(e, msg);
                errors.push({ index, error: msg });
            }
        }

        res.status(errors.length > 0 ? 500 : 200).json({ results, errors });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const muteChat: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { recipient, duration } = req.body as {
            recipient?: string;
            duration?: number | null;
        };
        if (!recipient || duration === undefined) {
            return res.status(400).json({ message: 'Recipient and duration are required' });
        }

        const jid = getJid(recipient);
        await verifyJid(session, jid, 'number');
        const muteDuration = duration === null ? null : duration * 60 * 60 * 1000;
        await session.chatModify({ mute: muteDuration as any }, jid);

        res.status(200).json({
            message: `Chat ${duration === null ? 'unmuted' : 'muted for ' + duration + ' hours'}`,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const pinChat: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { recipient, pin } = req.body as { recipient?: string; pin?: boolean };
        if (!recipient || pin === undefined) {
            return res.status(400).json({ message: 'Recipient and pin status are required' });
        }

        const jid = getJid(recipient);
        await verifyJid(session, jid, 'number');
        await session.chatModify({ pin } as any, jid);

        res.status(200).json({ message: `Chat ${pin ? 'pinned' : 'unpinned'}` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const starMessage: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { recipient, messageId, star } = req.body as {
            recipient?: string;
            messageId?: string;
            star?: boolean;
        };
        if (!recipient || !messageId || star === undefined) {
            return res
                .status(400)
                .json({ message: 'Recipient, messageId, and star status are required' });
        }

        const jid = getJid(recipient);
        const key = { id: messageId, fromMe: true } as any;
        const modifyParams = { star: { messages: [key], star } } as any;
        await session.chatModify(modifyParams, jid);
        res.status(200).json({ message: `Message ${star ? 'starred' : 'unstarred'}` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateProfileStatus: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { status } = req.body as { status?: string };
        if (!status) return res.status(400).json({ message: 'Status is required' });

        await session.updateProfileStatus(status);
        res.status(200).json({ message: 'Profile status updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateProfileName: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { name } = req.body as { name?: string };
        if (!name) return res.status(400).json({ message: 'Name is required' });

        await session.updateProfileName(name);
        res.status(200).json({ message: 'Profile name updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateProfilePicture: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { jid, imageUrl } = req.body as { jid?: string; imageUrl?: string };
        if (!jid || !imageUrl)
            return res.status(400).json({ message: 'jid and imageUrl are required' });

        await session.updateProfilePicture(jid, { url: imageUrl });
        res.status(200).json({ message: 'Profile picture updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const removeProfilePicture: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { myNumber } = req.body as { myNumber?: string };
        if (!myNumber) return res.status(400).json({ message: 'myNumber is required' });

        const jid = getJid(myNumber);
        await verifyJid(session, jid, 'number');
        await session.removeProfilePicture(jid);
        res.status(200).json({ message: 'Profile picture removed successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateBlockStatus: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const session = getInstance(sessionId);
        if (!session) return res.status(404).json({ message: 'Session not found' });
        if (!isUUID(sessionId)) return res.status(400).json({ message: 'Invalid sessionId' });

        const { contactId, action } = req.body as {
            contactId?: string;
            action?: 'block' | 'unblock';
        };
        if (!contactId || !action)
            return res.status(400).json({ message: 'contactId and action are required' });
        if (action !== 'block' && action !== 'unblock')
            return res.status(400).json({ message: 'action must be "block" or "unblock"' });

        await session.updateBlockStatus(contactId, action);
        res.status(200).json({ message: `User ${action}ed successfully` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createBroadcast: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: getMediaUploadErrorMessage(err) });
            }
            const uploadedPath = req.file?.path;
            let mediaPersisted = false;
            try {
                const { deviceId } = req.authenticatedDevice;
                const { name, message } = req.body as { name?: string; message?: string };
                // Coerce recipients to array for both JSON and multipart
                const bodyRecipients: any = (req.body as any).recipients;
                const recipients: string[] = Array.isArray(bodyRecipients)
                    ? bodyRecipients
                    : typeof bodyRecipients === 'string' && bodyRecipients.length
                    ? [bodyRecipients]
                    : [];
                const delay = Number((req.body as any).delay) ?? 5000;
                // Normalize schedule: default to now if missing/invalid
                const rawSchedule = (req.body as any).schedule as string | undefined;
                const schedule =
                    rawSchedule && !isNaN(new Date(rawSchedule).getTime())
                        ? new Date(rawSchedule)
                        : new Date();

                if (!name || !message) {
                    return res
                        .status(400)
                        .json({ message: 'Missing required fields: name and message' });
                }
                if (!recipients.length) {
                    return res.status(400).json({ message: 'Recipients are required' });
                }

                if (
                    recipients.includes('all') &&
                    recipients.some((recipient: string) => recipient.startsWith('label'))
                ) {
                    return res.status(400).json({
                        message:
                            "Recipients can't contain both all contacts and contact labels at the same input",
                    });
                }

                const device = await prisma.device.findUnique({
                    where: { pkId: deviceId },
                    include: { sessions: { select: { sessionId: true } } },
                });

                if (!device) {
                    return res.status(404).json({ message: 'Device not found' });
                }
                if (!device.sessions[0]) {
                    return res.status(404).json({ message: 'Session not found' });
                }
                await prisma.$transaction(async (transaction) => {
                    await transaction.broadcast.create({
                        data: {
                            name: name.includes('[Broadcast]') ? name : `${name} [Broadcast]`,
                            message: encryptMessage(message),
                            schedule,
                            deviceId: device.pkId,
                            delay,
                            broadcastType: 'broadcast', // 🔥 Set type for AdminSentHistory
                            recipients: { set: recipients },
                            mediaPath: uploadedPath,
                            mediaFileName: req.file
                                ? sanitizeMediaFileName(req.file.originalname)
                                : null,
                        },
                    });
                });
                mediaPersisted = true;
                return res.status(201).json({ message: 'Broadcast created successfully' });
            } catch (error) {
                logger.error(error);
                if (!res.headersSent) {
                    return res.status(500).json({ message: 'Internal server error' });
                }
            } finally {
                await cleanupUnpersistedUpload(
                    uploadedPath,
                    mediaPersisted,
                    'create-device-api-broadcast-failed',
                );
            }
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createAutoReplies: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: getMediaUploadErrorMessage(err) });
            }
            const { deviceId } = req.authenticatedDevice;
            const { name, recipients, requests, response } = req.body;

            if (
                recipients.includes('all') &&
                recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
                    recipient.startsWith('label'),
                )
            ) {
                return res.status(400).json({
                    message:
                        "Recipients can't contain both all contacts and contact labels at the same input",
                });
            }

            const device = await prisma.device.findUnique({
                where: { pkId: deviceId },
            });

            if (!device) {
                return res.status(404).json({ message: 'Device not found' });
            }

            const existingRequest = await prisma.autoReply.findFirst({
                where: { requests: { hasSome: requests }, deviceId: device.pkId },
            });

            if (existingRequest) {
                return res.status(400).json({ message: 'Request keywords already defined' });
            }

            await prisma.$transaction(async (transaction) => {
                const autoReply = await transaction.autoReply.create({
                    data: {
                        name,
                        requests: {
                            set: requests,
                        },
                        response,
                        deviceId: device.pkId,
                        recipients: {
                            set: recipients,
                        },
                        mediaPath: req.file?.path,
                    },
                });
                res.status(201).json(autoReply);
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteAllMessages: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        await prisma.$transaction(async (transaction) => {
            await transaction.message.deleteMany({ where: { sessionId } });
            await transaction.incomingMessage.deleteMany({ where: { sessionId } });
            await transaction.outgoingMessage.deleteMany({ where: { sessionId } });
        });
        res.status(200).json({ message: 'All messages deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBroadcasts: RequestHandler = async (req, res) => {
    try {
        const { deviceId } = req.authenticatedDevice;
        const broadcasts = await prisma.broadcast.findMany({
            where: { deviceId },
        });
        res.status(200).json(decryptBroadcasts(broadcasts));
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBroadcastsName: RequestHandler = async (req, res) => {
    try {
        const { deviceId } = req.authenticatedDevice;

        // Ambil semua broadcast yang terkait dengan deviceId
        const broadcasts = await prisma.broadcast.findMany({
            where: { deviceId },
            orderBy: { createdAt: 'desc' }, // Pastikan mengambil yang terbaru
        });

        // Gunakan objek untuk menyimpan hanya satu broadcast per nama
        const uniqueBroadcasts = Object.values(
            broadcasts.reduce(
                (acc, broadcast) => {
                    if (!acc[broadcast.name]) {
                        acc[broadcast.name] = broadcast;
                    }
                    return acc;
                },
                {} as Record<string, (typeof broadcasts)[0]>,
            ),
        );

        res.status(200).json(decryptBroadcasts(uniqueBroadcasts));
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// export const getBroadcastsByRecipient: RequestHandler = async (req, res) => {
//     try {
//         const { deviceId } = req.authenticatedDevice;
//         const { recipient } = req.query;

//         if (!recipient) {
//             return res.status(400).json({ message: 'Recipient is required' });
//         }

//         const broadcasts = await prisma.broadcast.findMany({
//             where: {
//                 deviceId,
//                 recipients: {
//                     has: recipient.toString(),
//                 },
//             },
//             select: {
//                 name: true,
//             },
//         });

//         res.status(200).json(broadcasts);
//     } catch (error) {
//         logger.error(error);
//         res.status(500).json({ message: 'Internal server error' });
//     }
// };

export const deleteAllBroadcasts: RequestHandler = async (req, res) => {
    try {
        const { deviceId } = req.authenticatedDevice;
        await prisma.broadcast.deleteMany({ where: { deviceId } });
        res.status(200).json({ message: 'All broadcasts deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteBroadcastsByName: RequestHandler = async (req, res) => {
    try {
        const { deviceId } = req.authenticatedDevice;
        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'Broadcast name is required' });
        }

        const deleted = await prisma.broadcast.deleteMany({
            where: { deviceId, name },
        });

        if (deleted.count === 0) {
            return res.status(404).json({ message: 'No broadcasts found with the given name' });
        }

        res.status(200).json({ message: `Broadcasts with name '${name}' deleted successfully` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const exportMessagesToZip: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { phoneNumber, contactName } = req.query;
        const sort = req.query.sort as string;

        const incomingMessages = await prisma.incomingMessage.findMany({
            where: {
                sessionId,
                from: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                contact: {
                    OR: contactName
                        ? [
                              {
                                  firstName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                              {
                                  lastName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                          ]
                        : undefined,
                },
            },
            select: {
                from: true,
                receivedAt: true,
                createdAt: true,
                contact: true,
                message: true,
                mediaPath: true,
            },
        });

        const outgoingMessages = await prisma.outgoingMessage.findMany({
            where: {
                sessionId,
                to: { contains: phoneNumber ? phoneNumber.toString() : undefined },
                contact: {
                    OR: contactName
                        ? [
                              {
                                  firstName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                              {
                                  lastName: {
                                      contains: contactName.toString(),
                                      mode: 'insensitive',
                                  },
                              },
                          ]
                        : undefined,
                },
            },
            select: { to: true, createdAt: true, contact: true, message: true, mediaPath: true },
        });

        const phoneSend = await prisma.session.findFirst({
            where: { sessionId: sessionId },
            select: {
                device: {
                    select: {
                        phone: true,
                    },
                },
            },
        });

        type Message = {
            from?: string;
            createdAt: Date;
            receivedAt?: Date;
            to?: string;
            phone?: string;
            message?: string | null;
            mediaPath?: string | null;
        };

        // Combine incoming and outgoing messages into one array
        const allMessages: Message[] = [
            ...incomingMessages.map(decryptIncomingMessage),
            ...outgoingMessages.map(decryptOutgoingMessage),
        ];
        for (const message of allMessages) {
            if ('from' in message) {
                message.receivedAt = message.receivedAt;
                message.phone = message.from?.replace('@s.whatsapp.net', '') || 'Unknown';
                delete message.from;
            } else if ('to' in message) {
                const senderName = phoneSend?.device.phone?.toString() || 'Unknown';
                message.phone = senderName;
                delete message.to;
            }
        }

        // Sort the combined messages by timestamp
        sort == 'asc'
            ? allMessages.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
            : allMessages.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

        // Convert the messages to strings
        let dataMessages = '';
        for (const message of allMessages) {
            if ('receivedAt' in message) {
                dataMessages += `${message.receivedAt} - ${message.phone}: ${message.message}\n`;
            } else {
                dataMessages += `${message.createdAt} - ${message.phone}: ${message.message}\n`;
            }
        }

        let mediaPath = [];
        for (const message of allMessages) {
            if (message.mediaPath) {
                mediaPath.push(message.mediaPath);
            }
        }

        // Create a zip file
        const JSZip = require('jszip');
        const zip = new JSZip();
        zip.file('messages.txt', dataMessages.toString());
        zip.folder('media');
        const folderMedia = zip.folder('media');
        if (folderMedia) {
            mediaPath.forEach((image, index) => {
                const imageBuffer = fs.readFileSync(image);
                folderMedia.file(`${index}.jpg`, imageBuffer);
            });
        }

        const zipContent = await zip.generateAsync({ type: 'nodebuffer' });

        res.set('Content-Type', 'application/zip');
        res.set('Content-Disposition', `attachment; filename=${sessionId}-messages.zip`);
        res.set('Content-Length', zipContent.length);
        res.send(zipContent);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getGroups: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;

        if (!sessionId || !isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        try {
            const session = getInstance(sessionId);
            if (!session) {
                return res.status(404).json({ message: 'Session not found' });
            }

            const groups = await session.groupFetchAllParticipating();
            const results = [];

            for (const [groupId, groupInfo] of Object.entries(groups)) {
                try {
                    // Untuk Baileys, groupId sudah dalam format short
                    // Coba ambil participants untuk generate full ID
                    let fullId = groupId;

                    if (typeof (session as any).groupMetadata === 'function') {
                        const metadata = await (session as any).groupMetadata(groupId);
                        // Jika metadata ada id, gunakan itu (biasanya sudah full ID)
                        if (metadata?.id) {
                            fullId = metadata.id;
                        }
                    }

                    results.push({
                        id: fullId,
                        name: groupInfo.subject || 'Unnamed Group',
                        participants: groupInfo.participants?.length || 0,
                    });
                } catch (err) {
                    // Fallback tetap return short ID jika metadata gagal
                    results.push({
                        id: groupId,
                        name: groupInfo.subject || 'Unnamed Group',
                        participants: groupInfo.participants?.length || 0,
                    });
                }
            }

            return res.status(200).json({
                results,
                note: 'Both full ID (with hyphen) and short ID (without hyphen) can be used to send messages',
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'An error occurred while fetching groups';
            logger.error(error, message);
            return res.status(500).json({ message });
        }
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getGroupsWithFullId: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;

        if (!sessionId || !isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        try {
            const session = getInstance(sessionId);
            if (!session) {
                return res.status(404).json({ message: 'Session not found' });
            }

            // Mendapatkan semua grup dari sesi
            const groups = await session.groupFetchAllParticipating();
            const results = [];

            // Untuk setiap group, ambil metadata lengkap untuk mendapatkan ID yang lebih detail
            for (const [groupId, groupInfo] of Object.entries(groups)) {
                try {
                    let fullId = groupId;
                    let metadata = null;

                    // Coba ambil metadata untuk mendapatkan informasi yang lebih lengkap
                    try {
                        if (typeof (session as any).groupMetadata === 'function') {
                            metadata = await (session as any).groupMetadata(groupId);
                            if (metadata?.id) {
                                fullId = metadata.id;
                            }
                        }
                    } catch (err) {
                        logger.warn(`Could not fetch metadata for ${groupId}`, err);
                    }

                    results.push({
                        id: fullId,
                        shortId: groupId, // Format singkat tanpa hyphen
                        name: groupInfo.subject || 'Unnamed Group',
                        description: groupInfo.desc || '',
                        owner: groupInfo.owner || '',
                        participants: groupInfo.participants?.length || 0,
                        createdAt: groupInfo.creation ? new Date(groupInfo.creation * 1000) : null,
                        // Informasi tentang format ID
                        idFormat: fullId.includes('-') ? 'full' : 'short',
                    });
                } catch (err) {
                    logger.warn(`Error processing group ${groupId}:`, err);
                    // Tetap tambahkan ke hasil meski error
                    results.push({
                        id: groupId,
                        shortId: groupId,
                        name: groupInfo.subject || 'Unnamed Group',
                        description: groupInfo.desc || '',
                        owner: groupInfo.owner || '',
                        participants: groupInfo.participants?.length || 0,
                        createdAt: groupInfo.creation ? new Date(groupInfo.creation * 1000) : null,
                        idFormat: 'unknown',
                    });
                }
            }

            return res.status(200).json({
                total: results.length,
                results,
                explanation: {
                    id: 'Group ID yang dapat digunakan untuk berbagai operasi',
                    shortId: 'Format ID pendek (gunakan ini jika "id" tidak ada hyphen)',
                    idFormat:
                        'full = dengan hyphen (120363317862454741-1234567890@g.us), short = tanpa hyphen (120363317862454741@g.us)',
                },
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'An error occurred while fetching groups';
            logger.error(error, message);
            return res.status(500).json({ message });
        }
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const searchGroups: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { query } = req.query;

        if (!sessionId || !isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        if (!query || typeof query !== 'string') {
            return res.status(400).json({ message: 'Search query is required' });
        }

        try {
            const session = getInstance(sessionId);
            if (!session) {
                return res.status(404).json({ message: 'Session not found' });
            }

            const groups = await session.groupFetchAllParticipating();
            const searchTerm = query.toLowerCase();

            // Filter grup berdasarkan nama
            const results = Object.entries(groups)
                .filter(([_, groupInfo]) =>
                    (groupInfo.subject || '').toLowerCase().includes(searchTerm),
                )
                .map(([groupId, groupInfo]) => ({
                    id: groupId,
                    name: groupInfo.subject || 'Unnamed Group',
                    description: groupInfo.desc || '',
                    participants: groupInfo.participants?.length || 0,
                }));

            return res.status(200).json({
                query,
                totalFound: results.length,
                results,
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'An error occurred while searching groups';
            logger.error(error, message);
            return res.status(500).json({ message });
        }
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getGroupById: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { groupId } = req.params;

        if (!sessionId || !isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        if (!groupId) {
            return res.status(400).json({ message: 'Group ID is required' });
        }

        try {
            const session = getInstance(sessionId);
            if (!session) {
                return res.status(404).json({ message: 'Session not found' });
            }

            // Normalisasi group ID
            const normalizedGroupId = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;

            // Dapatkan metadata grup
            const groupMetadata = await (session as any).groupMetadata(normalizedGroupId);

            if (!groupMetadata) {
                return res.status(404).json({ message: 'Group not found' });
            }

            const result = {
                id: groupMetadata.id,
                name: groupMetadata.subject || 'Unnamed Group',
                description: groupMetadata.desc || '',
                owner: groupMetadata.owner || '',
                participants: groupMetadata.participants?.length || 0,
                participantsList:
                    groupMetadata.participants?.map((p: any) => ({
                        id: p.id,
                        name: p.notify?.split('@')[0] || 'Unknown',
                        isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
                        isSuperAdmin: p.admin === 'superadmin',
                    })) || [],
                createdAt: groupMetadata.creation ? new Date(groupMetadata.creation * 1000) : null,
            };

            return res.status(200).json(result);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'An error occurred while fetching group';
            logger.error(error, message);
            return res.status(500).json({ message });
        }
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getGroupMembers: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;
        const { groupId } = req.params;

        if (!sessionId || !isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        if (!groupId) {
            return res.status(400).json({ message: 'Group ID is required' });
        }

        try {
            const session = getInstance(sessionId);
            if (!session) {
                return res.status(404).json({ message: 'Session not found' });
            }

            // Normalisasi group ID
            const normalizedGroupId = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;

            // Dapatkan metadata grup
            const groupMetadata = await (session as any).groupMetadata(normalizedGroupId);

            if (!groupMetadata) {
                return res.status(404).json({ message: 'Group not found' });
            }

            const members =
                groupMetadata.participants?.map((p: any) => ({
                    id: p.id,
                    phone: p.id?.split('@')[0] || 'Unknown',
                    isAdmin: p.admin === 'admin' || p.admin === 'superadmin',
                    isSuperAdmin: p.admin === 'superadmin',
                    isRestricted: p.admin ? true : false,
                })) || [];

            return res.status(200).json({
                groupId: groupMetadata.id,
                groupName: groupMetadata.subject || 'Unnamed Group',
                totalMembers: members.length,
                members,
            });
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'An error occurred while fetching members';
            logger.error(error, message);
            return res.status(500).json({ message });
        }
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const exportGroupsToCSV: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.authenticatedDevice;

        if (!sessionId || !isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        try {
            const session = getInstance(sessionId);
            if (!session) {
                return res.status(404).json({ message: 'Session not found' });
            }

            const groups = await session.groupFetchAllParticipating();

            // Format CSV header
            let csvContent = 'Group ID,Group Name,Participants Count,Description\n';

            // Tambahkan data grup
            Object.entries(groups).forEach(([groupId, groupInfo]) => {
                const groupName = (groupInfo.subject || 'Unnamed Group').replace(/"/g, '""');
                const description = (groupInfo.desc || '').replace(/"/g, '""');
                const participants = groupInfo.participants?.length || 0;

                csvContent += `"${groupId}","${groupName}",${participants},"${description}"\n`;
            });

            res.set('Content-Type', 'text/csv');
            res.set('Content-Disposition', `attachment; filename=groups-${sessionId}.csv`);
            res.send(csvContent);
        } catch (error) {
            const message =
                error instanceof Error ? error.message : 'An error occurred while exporting groups';
            logger.error(error, message);
            return res.status(500).json({ message });
        }
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const createBroadcastFeedback: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: getMediaUploadErrorMessage(err) });
            }

            const { deviceId } = req.authenticatedDevice;
            const { name, courseName, startLesson = 1, recipients } = req.body;
            // Terima juga startDate dari frontend (ISO string)
            const startDateRaw = req.body.startDate || req.body.schedule || '';
            const delay = Number(req.body.delay) || 5000;

            if (!name || !courseName || !recipients) {
                return res
                    .status(400)
                    .json({ message: 'Missing required fields: name, courseName, recipients' });
            }

            // pastikan recipients array
            const recipientArray = Array.isArray(recipients) ? recipients : [recipients];

            if (
                recipientArray.includes('all') &&
                recipientArray.some((recipient: string) => recipient.startsWith('label'))
            ) {
                return res.status(400).json({
                    message:
                        "Recipients can't contain both all contacts and contact labels at the same input",
                });
            }

            const device = await prisma.device.findUnique({
                where: { pkId: deviceId },
                include: { sessions: { select: { sessionId: true } } },
            });

            if (!device) {
                return res.status(404).json({ message: 'Device not found' });
            }
            if (!device.sessions[0]) {
                return res.status(404).json({ message: 'Session not found' });
            }

            const courseFeedbacks = await prisma.courseFeedback.findMany({
                where: {
                    courseName,
                    lesson: { gte: Number(startLesson) },
                },
                orderBy: { lesson: 'asc' },
            });

            if (courseFeedbacks.length === 0) {
                return res
                    .status(404)
                    .json({ message: 'No lessons found for the specified course' });
            }

            // Validasi dan gunakan startDate yang dikirim client (fallback ke now jika kosong)
            let baseDate: Date;
            if (startDateRaw) {
                const parsed = new Date(startDateRaw);
                if (isNaN(parsed.getTime())) {
                    return res.status(400).json({ message: 'Invalid startDate format' });
                }
                baseDate = parsed;
            } else {
                baseDate = new Date(); // fallback
            }

            // Opsional: jika baseDate < sekarang, bisa kembalikan error atau izinkan.
            // Contoh: blokir jika startDate di masa lalu
            // if (baseDate.getTime() < Date.now()) {
            //   return res.status(400).json({ message: 'startDate must be in the future' });
            // }

            await prisma.$transaction(async (transaction) => {
                for (let i = 0; i < courseFeedbacks.length; i++) {
                    const feedback = courseFeedbacks[i];
                    // buat salinan baseDate untuk tiap broadcast supaya tidak mutasi baseDate asli
                    const schedule = new Date(baseDate);
                    schedule.setDate(schedule.getDate() + i * 7); // + i minggu

                    await transaction.broadcast.create({
                        data: {
                            name: `${name} - ${courseName}`, // Store as "feedbackName - courseName"
                            message: encryptMessage(feedback.message),
                            schedule,
                            deviceId: device.pkId,
                            delay,
                            broadcastType: 'feedback', // 🔥 Set type for AdminSentHistory
                            recipients: {
                                set: recipientArray,
                            },
                            mediaPath: req.file?.path,
                            mediaFileName: req.file
                                ? sanitizeMediaFileName(req.file.originalname)
                                : null,
                        },
                    });
                }
            });

            res.status(201).json({
                message: 'Feedback broadcasts created successfully',
                broadcastName: `${name} - ${courseName}`,
            });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// export const createBroadcastFeedback: RequestHandler = async (req, res) => {
//     try {
//         diskUpload.single('media')(req, res, async (err: any) => {
//             if (err) {
//                 return res.status(400).json({ message: 'Error uploading file' });
//             }

//             const { deviceId } = req.authenticatedDevice;
//             const { name, courseName, startLesson = 1, recipients } = req.body;
//             const delay = Number(req.body.delay) ?? 5000;

//             if (!name || !courseName || !recipients) {
//                 return res
//                     .status(400)
//                     .json({ message: 'Missing required fields: name, courseName, recipients' });
//             }

//             if (
//                 recipients.includes('all') &&
//                 recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
//                     recipient.startsWith('label'),
//                 )
//             ) {
//                 return res.status(400).json({
//                     message:
//                         "Recipients can't contain both all contacts and contact labels at the same input",
//                 });
//             }

//             const device = await prisma.device.findUnique({
//                 where: { pkId: deviceId },
//                 include: { sessions: { select: { sessionId: true } } },
//             });

//             if (!device) {
//                 return res.status(404).json({ message: 'Device not found' });
//             }
//             if (!device.sessions[0]) {
//                 return res.status(404).json({ message: 'Session not found' });
//             }

//             const courseFeedbacks = await prisma.courseFeedback.findMany({
//                 where: {
//                     courseName,
//                     lesson: { gte: Number(startLesson) },
//                 },
//                 orderBy: { lesson: 'asc' },
//             });

//             if (courseFeedbacks.length === 0) {
//                 return res
//                     .status(404)
//                     .json({ message: 'No lessons found for the specified course' });
//             }

//             const now = new Date();

//             await prisma.$transaction(async (transaction) => {
//                 for (let i = 0; i < courseFeedbacks.length; i++) {
//                     const feedback = courseFeedbacks[i];
//                     const schedule = new Date(now);
//                     schedule.setDate(schedule.getDate() + i * 7); // Tambahkan 1 minggu untuk setiap lesson

//                     await transaction.broadcast.create({
//                         data: {
//                             name: `${name} - ${courseName}`, // Store as "feedbackName - courseName"
//                             message: feedback.message,
//                             schedule,
//                             deviceId: device.pkId,
//                             delay,
//                             recipients: {
//                                 set: recipients,
//                             },
//                             mediaPath: req.file?.path,
//                         },
//                     });
//                 }
//             });

//             res.status(201).json({
//                 message: 'Feedback broadcasts created successfully',
//                 broadcastName: `${name} - ${courseName}`,
//             });
//         });
//     } catch (error) {
//         logger.error(error);
//         res.status(500).json({ message: 'Internal server error' });
//     }
// };

export const createBroadcastReminder: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: getMediaUploadErrorMessage(err) });
            }

            const { deviceId } = req.authenticatedDevice;
            const { courseName, startLesson = 1, recipients } = req.body;
            const delay = Number(req.body.delay) || 5000;

            if (!courseName || !recipients) {
                return res.status(400).json({ message: 'Missing required fields' });
            }

            if (
                recipients.includes('all') &&
                recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
                    recipient.startsWith('label'),
                )
            ) {
                return res.status(400).json({
                    message:
                        "Recipients can't contain both all contacts and contact labels at the same input",
                });
            }

            const device = await prisma.device.findUnique({
                where: { pkId: deviceId },
                include: { sessions: { select: { sessionId: true } } },
            });

            if (!device) {
                return res.status(404).json({ message: 'Device not found' });
            }
            if (!device.sessions[0]) {
                return res.status(404).json({ message: 'Session not found' });
            }

            const courseReminders = await prisma.courseReminder.findMany({
                where: {
                    courseName,
                    lesson: { gte: Number(startLesson) },
                },
                orderBy: { lesson: 'asc' },
            });

            if (courseReminders.length === 0) {
                return res
                    .status(404)
                    .json({ message: 'No lessons found for the specified course' });
            }

            const now = new Date();

            await prisma.$transaction(async (transaction) => {
                for (let i = 0; i < courseReminders.length; i++) {
                    const reminder = courseReminders[i];
                    const schedule = new Date(now);
                    schedule.setDate(schedule.getDate() + i * 7); // Tambahkan 1 minggu untuk setiap lesson

                    await transaction.broadcast.create({
                        data: {
                            name: `${courseName} - Recipients ${recipients}`,
                            message: encryptMessage(reminder.message),
                            schedule,
                            deviceId: device.pkId,
                            delay,
                            recipients: {
                                set: recipients,
                            },
                            mediaPath: req.file?.path,
                            mediaFileName: req.file
                                ? sanitizeMediaFileName(req.file.originalname)
                                : null,
                        },
                    });
                }
            });

            res.status(201).json({ message: 'Broadcasts created successfully' });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createBroadcastScheduled: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: getMediaUploadErrorMessage(err) });
            }

            const uploadedPath = req.file?.path;
            let mediaPersisted = false;
            try {
                const { deviceId } = req.authenticatedDevice;
                const { name, message, recurrence, interval, startDate, endDate } = req.body;
                const delay = Number(req.body.delay) || 5000;

                // Pastikan recipients berbentuk array
                const recipients = Array.isArray(req.body.recipients)
                    ? req.body.recipients
                    : [req.body.recipients];

                // Validasi parameter
                if (
                    !recurrence ||
                    !['minute', 'hourly', 'daily', 'weekly', 'monthly'].includes(recurrence)
                ) {
                    return res.status(400).json({ message: 'Invalid or missing recurrence type' });
                }

                if (!interval || isNaN(Number(interval)) || Number(interval) <= 0) {
                    return res.status(400).json({ message: 'Interval must be a positive number' });
                }

                if (!startDate || isNaN(new Date(startDate).getTime())) {
                    return res.status(400).json({ message: 'Invalid or missing start date' });
                }

                if (!endDate || isNaN(new Date(endDate).getTime())) {
                    return res.status(400).json({ message: 'Invalid or missing end date' });
                }

                if (new Date(startDate) > new Date(endDate)) {
                    return res.status(400).json({ message: 'Start date must be before end date' });
                }

                if (
                    recipients.includes('all') &&
                    recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
                        recipient.startsWith('label'),
                    )
                ) {
                    return res.status(400).json({
                        message:
                            "Recipients can't contain both all contacts and contact labels at the same input",
                    });
                }

                // Ambil informasi perangkat
                const device = await prisma.device.findUnique({
                    where: { pkId: deviceId },
                    include: { sessions: { select: { sessionId: true } } },
                });

                if (!device) {
                    return res.status(404).json({ message: 'Device not found' });
                }
                if (!device.sessions[0]) {
                    return res.status(404).json({ message: 'Session not found' });
                }

                const start = new Date(startDate);
                const end = new Date(endDate);
                const broadcasts = [];
                let current = new Date(start);

                // Hitung dan buat pesan broadcast berdasarkan interval dan durasi
                while (current <= end) {
                    broadcasts.push({
                        name: name.includes('[Recurrence]') ? name : `${name} [Recurrence]`,
                        message: encryptMessage(message),
                        schedule: new Date(current),
                        deviceId: device.pkId,
                        delay,
                        broadcastType: 'recurrence', // 🔥 Set type for AdminSentHistory
                        recipients: { set: recipients },
                        mediaPath: uploadedPath,
                        mediaFileName: req.file
                            ? sanitizeMediaFileName(req.file.originalname)
                            : null,
                    });

                    switch (recurrence) {
                        case 'minute':
                            current.setMinutes(current.getMinutes() + Number(interval));
                            break;
                        case 'hourly':
                            current.setHours(current.getHours() + Number(interval));
                            break;
                        case 'daily':
                            current.setDate(current.getDate() + Number(interval));
                            break;
                        case 'weekly':
                            current.setDate(current.getDate() + Number(interval) * 7);
                            break;
                        case 'monthly':
                            current.setMonth(current.getMonth() + Number(interval));
                            break;
                    }
                }

                // Simpan semua broadcast ke database
                await prisma.$transaction(
                    broadcasts.map((broadcast) => prisma.broadcast.create({ data: broadcast })),
                );

                mediaPersisted = true;
                return res.status(201).json({
                    message: 'Broadcasts created successfully',
                    totalBroadcasts: broadcasts.length,
                });
            } catch (error) {
                logger.error(error);
                if (!res.headersSent) {
                    return res.status(500).json({ message: 'Internal server error' });
                }
            } finally {
                await cleanupUnpersistedUpload(
                    uploadedPath,
                    mediaPersisted,
                    'create-device-api-recurring-broadcast-failed',
                );
            }
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// untuk testing
// export const createBroadcastRecurring: RequestHandler = async (req, res) => {
//     try {
//         diskUpload.single('media')(req, res, async (err: any) => {
//             if (err) {
//                 return res.status(400).json({ message: 'Error uploading file' });
//             }

//             const { deviceId } = req.authenticatedDevice;
//             const { courseName, startLesson = 1, recipients } = req.body;
//             const delay = Number(req.body.delay) ?? 5000;

//             if (!courseName || !recipients) {
//                 return res.status(400).json({ message: 'Missing required fields' });
//             }

//             if (
//                 recipients.includes('all') &&
//                 recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
//                     recipient.startsWith('label'),
//                 )
//             ) {
//                 return res.status(400).json({
//                     message:
//                         "Recipients can't contain both all contacts and contact labels at the same input",
//                 });
//             }

//             const device = await prisma.device.findUnique({
//                 where: { pkId: deviceId },
//                 include: { sessions: { select: { sessionId: true } } },
//             });

//             if (!device) {
//                 return res.status(404).json({ message: 'Device not found' });
//             }
//             if (!device.sessions[0]) {
//                 return res.status(404).json({ message: 'Session not found' });
//             }

//             const courseReminders = await prisma.courseReminder.findMany({
//                 where: {
//                     courseName,
//                     lesson: { gte: Number(startLesson) },
//                 },
//                 orderBy: { lesson: 'asc' },
//             });

//             if (courseReminders.length === 0) {
//                 return res.status(404).json({ message: 'No lessons found for the specified course' });
//             }

//             const now = new Date();

//             await prisma.$transaction(async (transaction) => {
//                 for (let i = 0; i < courseReminders.length; i++) {
//                     const reminder = courseReminders[i];
//                     const schedule = new Date(now);
//                     schedule.setMinutes(schedule.getMinutes() + i * 2); // Tambahkan 2 menit untuk setiap lesson

//                     await transaction.broadcast.create({
//                         data: {
//                             name: `${courseName} - Lesson ${reminder.lesson}`,
//                             message: reminder.message,
//                             schedule,
//                             deviceId: device.pkId,
//                             delay,
//                             recipients: {
//                                 set: recipients,
//                             },
//                             mediaPath: req.file?.path,
//                         },
//                     });
//                 }
//             });

//             res.status(201).json({ message: 'Broadcasts created successfully (Test Mode: 2-min Interval)' });
//         });
//     } catch (error) {
//         logger.error(error);
//         res.status(500).json({ message: 'Internal server error' });
//     }
// };

export const createBroadcastReminderAlgo: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: getMediaUploadErrorMessage(err) });
            }

            const uploadedPath = req.file?.path;
            let mediaPersisted = false;
            try {
                const { deviceId } = req.authenticatedDevice;
                const { name, message, lessons, recipients } = req.body;
                // Terima juga schedule dari frontend (ISO string)
                const scheduleRaw = req.body.schedule || '';
                const delay = Number(req.body.delay) || 5000;

                if (!name || !message || !lessons || !recipients) {
                    return res.status(400).json({
                        message: 'Missing required fields: name, message, lessons, recipients',
                    });
                }

                // Validasi lessons harus berupa angka positif
                const lessonCount = Number(lessons);
                if (isNaN(lessonCount) || lessonCount <= 0) {
                    return res.status(400).json({ message: 'Lessons must be a positive number' });
                }

                // pastikan recipients array
                const recipientArray = Array.isArray(recipients) ? recipients : [recipients];

                if (
                    recipientArray.includes('all') &&
                    recipientArray.some((recipient: string) => recipient.startsWith('label'))
                ) {
                    return res.status(400).json({
                        message:
                            "Recipients can't contain both all contacts and contact labels at the same input",
                    });
                }

                const device = await prisma.device.findUnique({
                    where: { pkId: deviceId },
                    include: { sessions: { select: { sessionId: true } } },
                });

                if (!device) {
                    return res.status(404).json({ message: 'Device not found' });
                }
                if (!device.sessions[0]) {
                    return res.status(404).json({ message: 'Session not found' });
                }

                // Validasi dan gunakan schedule yang dikirim client (fallback ke now jika kosong)
                let baseDate: Date;
                if (scheduleRaw) {
                    const parsed = new Date(scheduleRaw);
                    if (isNaN(parsed.getTime())) {
                        return res.status(400).json({ message: 'Invalid schedule format' });
                    }
                    baseDate = parsed;
                } else {
                    baseDate = new Date(); // fallback
                }

                await prisma.$transaction(async (transaction) => {
                    for (let i = 0; i < lessonCount; i++) {
                        // buat salinan baseDate untuk tiap broadcast supaya tidak mutasi baseDate asli
                        const schedule = new Date(baseDate);
                        schedule.setDate(schedule.getDate() + i * 7); // + i minggu

                        await transaction.broadcast.create({
                            data: {
                                // name: `${name} - [Reminder]`, // Store as "reminderName - Lesson 1, 2, 3, etc"
                                name: name.includes('[Reminder]') ? name : `${name} [Reminder]`,
                                message: encryptMessage(message),
                                schedule,
                                deviceId: device.pkId,
                                delay,
                                broadcastType: 'reminder', // 🔥 Set type for AdminSentHistory
                                recipients: {
                                    set: recipientArray,
                                },
                                mediaPath: uploadedPath,
                                mediaFileName: req.file
                                    ? sanitizeMediaFileName(req.file.originalname)
                                    : null,
                            },
                        });
                    }
                });

                mediaPersisted = true;
                return res.status(201).json({
                    message: 'Reminder broadcasts created successfully',
                    broadcastName: name,
                    totalLessons: lessonCount,
                });
            } catch (error) {
                logger.error(error);
                if (!res.headersSent) {
                    return res.status(500).json({ message: 'Internal server error' });
                }
            } finally {
                await cleanupUnpersistedUpload(
                    uploadedPath,
                    mediaPersisted,
                    'create-device-api-reminder-broadcast-failed',
                );
            }
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// ============================================
// MONTHLY FEEDBACK (deviceApi pattern)
// ============================================

// Environment variables untuk role checking
const ADMIN_ID = Number(process.env.ADMIN_ID);
const SUPER_ADMIN_ID = Number(process.env.SUPER_ADMIN_ID);

// Helper function untuk check apakah user adalah admin
function isAdminUser(privilegeId: number | undefined): boolean {
    if (!privilegeId) return false;
    return privilegeId === ADMIN_ID || privilegeId === SUPER_ADMIN_ID;
}

// Helper function untuk set device rate limit berdasarkan role user
function configureDeviceRateLimit(deviceId: string, privilegeId: number | undefined): void {
    if (isAdminUser(privilegeId)) {
        setDeviceAsShared(deviceId);
        logger.info(`[RateLimit] Device ${deviceId} configured as SHARED (Admin user)`);
    } else {
        setDeviceAsPersonal(deviceId);
        logger.info(`[RateLimit] Device ${deviceId} configured as PERSONAL (Tutor user)`);
    }
}

// Helper function untuk expand label menjadi daftar kontak dengan firstName
interface ExpandedContact {
    phone: string;
    firstName: string;
}

async function expandLabelToContacts(
    labelNameOrSlug: string,
    deviceId: string,
): Promise<ExpandedContact[]> {
    try {
        logger.info(`[Label] Expanding label "${labelNameOrSlug}" for device ${deviceId}`);

        // Find the label by name OR slug (case-insensitive)
        const label = await prisma.label.findFirst({
            where: {
                OR: [
                    {
                        name: {
                            equals: labelNameOrSlug,
                            mode: 'insensitive',
                        },
                    },
                    {
                        slug: {
                            equals: labelNameOrSlug,
                            mode: 'insensitive',
                        },
                    },
                ],
            },
        });

        if (!label) {
            logger.warn(
                `[Label] Label "${labelNameOrSlug}" not found in database (checked both name and slug)`,
            );
            return [];
        }

        logger.info(
            `[Label] Found label: pkId=${label.pkId}, name="${label.name}", slug="${label.slug}"`,
        );

        // Then find contacts with this label that are associated with the device
        const contactsWithLabel = await prisma.contact.findMany({
            where: {
                ContactLabel: {
                    some: {
                        labelId: label.pkId,
                    },
                },
                contactDevices: {
                    some: {
                        device: {
                            id: deviceId,
                        },
                    },
                },
            },
            select: {
                pkId: true,
                phone: true,
                firstName: true,
            },
        });

        logger.info(
            `[Label] Found ${contactsWithLabel.length} contacts with label "${label.name}"`,
        );

        if (contactsWithLabel.length === 0) {
            // Debug: check if contacts exist with this label at all
            const allContactsWithLabel = await prisma.contactLabel.count({
                where: { labelId: label.pkId },
            });
            logger.warn(
                `[Label] Total ContactLabel entries for this label: ${allContactsWithLabel}`,
            );

            // Debug: check if device has any contacts
            const deviceContacts = await prisma.contactDevice.count({
                where: {
                    device: { id: deviceId },
                },
            });
            logger.warn(`[Label] Total contacts for device ${deviceId}: ${deviceContacts}`);

            // Debug: check intersection - contacts with label that also belong to device
            const contactIdsWithLabel = await prisma.contactLabel.findMany({
                where: { labelId: label.pkId },
                select: { contactId: true },
            });
            const contactIds = contactIdsWithLabel.map((c) => c.contactId);

            if (contactIds.length > 0) {
                const contactsAlsoInDevice = await prisma.contactDevice.count({
                    where: {
                        contactId: { in: contactIds },
                        device: { id: deviceId },
                    },
                });
                logger.warn(
                    `[Label] Contacts with this label that also belong to device: ${contactsAlsoInDevice}`,
                );
            }
        }

        // 🆕 Return both phone and firstName
        const expandedContacts = contactsWithLabel
            .filter((contact) => contact.phone && contact.phone.length > 0)
            .map((contact) => ({
                phone: contact.phone!,
                firstName: contact.firstName || '',
            }));

        logger.info(
            `[Label] Label "${label.name}" expanded to ${
                expandedContacts.length
            } contacts: ${expandedContacts
                .map((c) => `${c.firstName?.substring(0, 3)}*** (${c.phone.substring(0, 5)}***)`)
                .join(', ')}`,
        );
        return expandedContacts;
    } catch (error) {
        logger.error(`[Label] Error expanding label "${labelNameOrSlug}":`, error);
        return [];
    }
}

// 🆕 Updated to return contacts with firstName
interface ProcessedRecipient {
    phone: string;
    firstName: string;
}

async function processRecipientsForFeedback(
    recipients: string[],
    deviceId: string,
): Promise<ProcessedRecipient[]> {
    const processedRecipients: ProcessedRecipient[] = [];

    for (const recipient of recipients) {
        if (typeof recipient === 'string' && recipient.toLowerCase().startsWith('label_')) {
            const labelName = recipient.slice(6);
            logger.info(`Expanding label: ${labelName}`);
            const labelContacts = await expandLabelToContacts(labelName, deviceId);
            // Add all contacts from label with their firstName
            processedRecipients.push(...labelContacts);
        } else {
            // Regular phone number - no firstName available from label expansion
            processedRecipients.push({ phone: recipient, firstName: '' });
        }
    }

    // Remove duplicates by phone, keeping first occurrence
    const seen = new Set<string>();
    const uniqueRecipients = processedRecipients.filter((r) => {
        if (seen.has(r.phone)) return false;
        seen.add(r.phone);
        return true;
    });

    logger.info(
        `Processed recipients: ${recipients.length} input -> ${uniqueRecipients.length} unique recipients`,
    );

    return uniqueRecipients;
}

// Send monthly feedback with PDF (deviceApi pattern - uses req.authenticatedDevice)
// 🆕 Updated to support multi-recipient with individual student names
export const sendMonthlyFeedbackDevice: RequestHandler = async (req, res) => {
    try {
        logger.info('=== Starting monthly feedback send (deviceApi) ===');

        // Get device from authenticated token (NOT from body)
        // deviceId is INT (pkId), deviceUuid is string (UUID) - added by middleware
        const devicePkId = req.authenticatedDevice.deviceId;
        const deviceUuid = (req.authenticatedDevice as any).deviceUuid as string;
        const user = req.authenticatedUser; // User is set separately by middleware

        const {
            studentName, // Legacy: single studentName (backward compatibility)
            courseName,
            month,
            duration,
            level,
            code,
            topicModule,
            result,
            skillsAcquired,
            youtubeLink,
            referralLink,
            tutorComment, // Now can be array of comment IDs
            commentCategories, // 🆕 Template komentar untuk replace nama
            recipientPhone,
            recipients, // 🆕 Now array of { phone, studentName }
            rating,
            reportBy,
        } = req.body;

        logger.info('Request:', {
            courseName,
            month,
            deviceId: deviceUuid,
            recipientCount: recipients?.length || (recipientPhone ? 1 : 0),
            hasCommentCategories: !!commentCategories,
            tutorCommentType: Array.isArray(tutorComment) ? 'array' : typeof tutorComment,
        });

        // 🆕 Handle new format: recipients is array of {phone, studentName}
        // or legacy format: recipients is array of phone strings
        let recipientDataList: Array<{ phone: string; studentName: string }> = [];

        if (recipients && Array.isArray(recipients) && recipients.length > 0) {
            if (typeof recipients[0] === 'object' && recipients[0].phone) {
                // New format: [{phone, studentName}, ...]
                recipientDataList = recipients;
            } else {
                // Legacy format: ['phone1', 'phone2', ...] - use single studentName
                recipientDataList = recipients.map((phone: string) => ({
                    phone,
                    studentName: studentName || 'Siswa',
                }));
            }
        } else if (recipientPhone) {
            // Single recipient (legacy)
            recipientDataList = [{ phone: recipientPhone, studentName: studentName || 'Siswa' }];
        }

        if (!courseName || !month || recipientDataList.length === 0) {
            logger.warn('Missing required fields');
            return res.status(400).json({
                message: 'Missing required fields',
                details: {
                    courseName: !courseName ? 'required' : 'ok',
                    month: !month ? 'required' : 'ok',
                    recipients: recipientDataList.length === 0 ? 'required (at least 1)' : 'ok',
                },
            });
        }

        // 🆕 Function to build tutor comment from selected IDs and categories
        const buildTutorComment = (
            selectedIds: string[],
            categories: any,
            recipientStudentName: string,
        ): string => {
            if (!selectedIds || !Array.isArray(selectedIds) || !categories) {
                // Fallback: tutorComment might be a plain string (legacy)
                return typeof tutorComment === 'string' ? tutorComment : '';
            }

            const comments: string[] = [];
            const allCategories = ['kehadiran', 'keterlibatan', 'penyelesaian', 'custom'];

            for (const categoryKey of allCategories) {
                const category = categories[categoryKey];
                if (!category || !Array.isArray(category)) continue;

                for (const comment of category) {
                    if (selectedIds.includes(comment.id)) {
                        let text = comment.text || '';
                        // Replace placeholder name with actual student name
                        // Handle both "M. Alghifari Setyawan" and {{firstname}}
                        text = text.replace(/M\. Alghifari Setyawan/g, recipientStudentName);
                        text = text.replace(/\{\{firstname\}\}/gi, recipientStudentName);
                        if (text.trim()) {
                            comments.push(text);
                        }
                    }
                }
            }

            return comments.join('\n\n');
        };

        // Device already verified by deviceTokenOnly middleware - no need to check again
        logger.info('Device authenticated via token:', deviceUuid);

        // Configure device rate limit based on user role
        const privilegeId = (user as any)?.privilege?.pkId;
        configureDeviceRateLimit(deviceUuid, privilegeId);

        const sessionId = req.authenticatedDevice.sessionId;
        if (!sessionId || !isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid WhatsApp session' });
        }

        let session;
        try {
            session = getInstance(sessionId);
        } catch (error) {
            logger.warn({ sessionId, error }, 'Monthly feedback session is not available');
            return res.status(503).json({ message: 'WhatsApp session not found or not connected' });
        }

        if (!session?.user) {
            return res.status(503).json({ message: 'WhatsApp session not connected' });
        }

        // Process recipients - expand labels to actual phone numbers with firstName
        // 🆕 Keep mapping of original phone to studentName (from frontend)
        const phoneToNameMap: Record<string, string> = {};
        for (const rd of recipientDataList) {
            phoneToNameMap[rd.phone] = rd.studentName;
        }

        const rawPhones = recipientDataList.map((rd) => rd.phone);
        const processedRecipients = await processRecipientsForFeedback(rawPhones, deviceUuid);

        if (processedRecipients.length === 0) {
            logger.warn('No valid recipients after processing labels');
            return res.status(400).json({
                message: 'No valid recipients found. Labels may be empty or contacts not found.',
                originalRecipients: rawPhones,
            });
        }

        // 🆕 Build final recipient list with studentNames
        // Priority: 1) firstName from label expansion, 2) studentName from frontend, 3) fallback
        const finalRecipientList: Array<{ phone: string; studentName: string }> = [];
        for (const processed of processedRecipients) {
            const { phone, firstName } = processed;

            // Priority 1: Use firstName from label expansion (kontak's actual name)
            if (firstName && firstName.trim()) {
                finalRecipientList.push({ phone, studentName: firstName });
                logger.info(
                    `[Recipient] ${phone.substring(
                        0,
                        5,
                    )}*** using firstName from contact: "${firstName}"`,
                );
            }
            // Priority 2: Use studentName from frontend (for direct phone numbers)
            else if (phoneToNameMap[phone] && phoneToNameMap[phone] !== 'Tidak ada nama') {
                finalRecipientList.push({ phone, studentName: phoneToNameMap[phone] });
                logger.info(
                    `[Recipient] ${phone.substring(0, 5)}*** using studentName from frontend: "${
                        phoneToNameMap[phone]
                    }"`,
                );
            }
            // Priority 3: Fallback to default studentName from first recipient
            else {
                const fallbackName = recipientDataList[0]?.studentName || 'Siswa';
                finalRecipientList.push({ phone, studentName: fallbackName });
                logger.info(
                    `[Recipient] ${phone.substring(
                        0,
                        5,
                    )}*** using fallback name: "${fallbackName}"`,
                );
            }
        }

        logger.info(`Processing ${finalRecipientList.length} recipient(s) with individual names`);

        const tutorName = reportBy || 'Tutor';

        // PDF generation remains parallel (up to three at once); sending is sequential.

        // 🚀 OPTIMIZED: Parallel PDF generation with concurrency limit
        const createDocumentForRecipient = async (recipientData: {
            phone: string;
            studentName: string;
        }) => {
            const { phone: recipient, studentName: recipientStudentName } = recipientData;
            logger.info(
                `Generating PDF for: ${recipientStudentName?.substring(0, 2)}*** -> ${redactPhone(
                    recipient,
                )}`,
            );

            // Build tutor comment for this recipient
            const finalTutorComment = Array.isArray(tutorComment)
                ? buildTutorComment(tutorComment, commentCategories, recipientStudentName)
                : typeof tutorComment === 'string'
                ? tutorComment
                      .replace(/M\. Alghifari Setyawan/g, recipientStudentName)
                      .replace(/\{\{firstname\}\}/gi, recipientStudentName)
                : '';

            // Generate PDF for this specific recipient
            const pdfBuffer = await generateMonthlyFeedbackPDFWithPuppeteer({
                studentName: recipientStudentName,
                courseName,
                month: Number(month),
                duration: duration || `Bulan ke-${month}`,
                level: level || '',
                code: code || '',
                topicModule: topicModule || '',
                result: result || '',
                skillsAcquired: skillsAcquired || '',
                youtubeLink: youtubeLink || '',
                referralLink: referralLink || '',
                tutorComment: finalTutorComment,
                rating: rating || 5,
                reportBy: reportBy || 'Tutor',
            });

            const fileName = `Feedback_${recipientStudentName.replace(
                /\s+/g,
                '_',
            )}_${courseName.replace(/\s+/g, '_')}_Bulan${month}.pdf`;

            const caption = `Halo, Ayah/Bunda dari ${recipientStudentName}! 👋

Saya ${tutorName}, tutor ${recipientStudentName} di Sekolah Pemrograman Internasional Algorithmics.

Saya ingin berbagi kabar tentang perkembangan ${recipientStudentName} selama satu bulan terakhir. Kami telah menilai kemajuan ${recipientStudentName} berdasarkan keterampilan yang dipelajari di kelas, serta upaya yang telah ditunjukkan dalam menyelesaikan berbagai tugas. 😊 Hasil lengkapnya bisa Anda lihat pada lampiran yang sudah kami sediakan 📄.

Penilaian ini meliputi bintang dan poin yang diperoleh ${recipientStudentName} atas kinerja dalam berbagai keterampilan utama yang diajarkan di kelas. Bintang tersebut merefleksikan seberapa baik ${recipientStudentName} menguasai materi dan menerapkan keterampilannya, baik dalam tugas rumah maupun tugas kelas. Poin tambahan juga diberikan sebagai penghargaan atas kerja keras dan ketekunan yang ditunjukkan oleh ${recipientStudentName}.

Jika ada hal yang ingin ditanyakan mengenai hasil ini atau tentang perkembangan ${recipientStudentName}, saya siap membantu menjelaskan lebih lanjut. Terima kasih atas dukungan Anda dalam proses belajar ${recipientStudentName}, dan mari kita terus bekerja sama untuk mencapai hasil yang lebih baik ke depannya! 💜`;

            return {
                buffer: pdfBuffer,
                fileName,
                caption,
            };
        };

        // 🚀 Process recipients in parallel batches
        const startTime = Date.now();
        const batchResult = await sendMonthlyFeedbackBatch({
            session,
            deviceUuid,
            devicePkId,
            recipients: finalRecipientList,
            pdfConcurrency: 3,
            createDocument: createDocumentForRecipient,
        });
        const sendResults = batchResult.results;
        const totalTime = ((Date.now() - startTime) / 1000).toFixed(1);
        logger.info(
            {
                totalTime,
                success: batchResult.success,
                failed: batchResult.failed,
                paused: batchResult.paused,
                invalid: batchResult.invalid,
                duplicatesRemoved: batchResult.duplicatesRemoved,
                stoppedReason: batchResult.stoppedReason,
            },
            'Protected monthly feedback processing completed',
        );

        // 🚀 OPTIMIZED: Batch database insert instead of individual inserts
        try {
            const userId = (user as any)?.id;
            if (userId) {
                const successResults = sendResults.filter((r) => r.status === 'success');

                if (successResults.length > 0) {
                    const logsToCreate = successResults.map((result) => ({
                        studentName: result.studentName,
                        courseName,
                        month: Number(month),
                        recipientPhone: result.normalizedRecipient || result.recipient,
                        sentBy: userId,
                        sentAt: new Date(),
                    }));

                    await prisma.monthlyFeedbackLog.createMany({
                        data: logsToCreate,
                    });

                    logger.info(`✅ Batch inserted ${logsToCreate.length} feedback logs`);
                }
            }
        } catch (err) {
            logger.error('Error logging to database:', err);
        }

        const successCount = sendResults.filter((r) => r.status === 'success').length;
        const failedCount = sendResults.filter((r) => r.status === 'failed').length;
        const pausedCount = sendResults.filter((r) => r.status === 'paused').length;

        logger.info(
            `=== Monthly feedback sent: ${successCount} success, ${failedCount} failed, ${pausedCount} paused ===`,
        );

        res.status(200).json({
            message: batchResult.stoppedReason
                ? `Monthly feedback paused: ${batchResult.stoppedReason}`
                : `Monthly feedback sent to ${successCount} recipient(s)`,
            results: sendResults,
            summary: {
                total: batchResult.total,
                success: successCount,
                failed: failedCount,
                paused: pausedCount,
                invalid: batchResult.invalid,
                duplicatesRemoved: batchResult.duplicatesRemoved,
            },
            stoppedReason: batchResult.stoppedReason,
        });
    } catch (error) {
        logger.error('=== Error sending monthly feedback ===');
        logger.error('Error:', error instanceof Error ? error.message : 'Unknown error');

        res.status(500).json({
            message: 'Failed to send monthly feedback',
            error: error instanceof Error ? error.message : 'Unknown error',
        });
    }
};
