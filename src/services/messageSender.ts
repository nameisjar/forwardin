// filepath: d:\Doc\autosender\forwardin\src\services\messageSender.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeWithRateLimit, RateLimitResult } from './rateLimiter';
import { canDeviceSend, incrementMessageCount } from './signalDetector';
import prisma from '../utils/db';
import logger from '../config/logger';
import { encryptMessage } from '../utils/messageEncryption';
import { getSocketIO } from '../socket';
import { createInboxProfileUrl } from '../utils/inboxMedia';
import { refreshInboxProfileCache } from './inboxProfileCache';
import { assertOutboundRecipientAvailable } from './outboundPrivacyGuard';

// ============================================
// 🚀 MESSAGE SENDER SERVICE
// ============================================
// 
// Wrapper untuk semua pengiriman pesan WhatsApp
// dengan integrasi Rate Limiter untuk mencegah ban.
//
// SEMUA pengiriman pesan HARUS melalui service ini!
// ============================================

type DeviceContext = { pkId: number; sessionId: string | null };

async function getDeviceContext(deviceId: string): Promise<DeviceContext | null> {
    const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: {
            pkId: true,
            sessions: {
                where: { id: { contains: 'config' } },
                select: { sessionId: true },
                orderBy: { pkId: 'desc' },
                take: 1,
            },
        },
    });

    if (!device) return null;

    const context = {
        pkId: device.pkId,
        sessionId: device.sessions[0]?.sessionId || null,
    };
    return context;
}

/**
 * Get device pkId from deviceId (UUID) with caching
 */
async function getDevicePkId(deviceId: string): Promise<number | null> {
    return (await getDeviceContext(deviceId))?.pkId || null;
}

async function assertDeviceCanSend(deviceId: string): Promise<void> {
    const devicePkId = await getDevicePkId(deviceId);
    if (!devicePkId) throw new Error('Device tidak ditemukan');

    const health = await canDeviceSend(devicePkId);
    if (!health.allowed) {
        throw new Error(health.reason || 'Pengiriman device sedang dijeda oleh sistem keamanan');
    }
}

async function persistOutgoingMessage(params: {
    deviceId: string;
    jid: string;
    messageId?: string;
    text?: string;
    mediaPath?: string | null;
    fileName?: string | null;
    session?: any;
}): Promise<void> {
    if (!params.messageId) return;

    try {
        const context = await getDeviceContext(params.deviceId);
        if (!context) {
            logger.warn(
                { deviceId: params.deviceId, messageId: params.messageId },
                '[MessageSender] Cannot persist outgoing message: device not found',
            );
            return;
        }

        const phone = params.jid.split('@')[0].replace(/\D/g, '');
        const contact = await prisma.contact.findFirst({
            where: {
                phone: { in: [phone, `+${phone}`] },
                contactDevices: { some: { deviceId: context.pkId } },
            },
            select: { pkId: true },
        });
        const encryptedText = params.text ? encryptMessage(params.text) : null;

        const savedMessage = await prisma.outgoingMessage.upsert({
            where: { id: params.messageId },
            update: {
                waMessageId: params.messageId,
                to: params.jid,
                sessionId: context.sessionId,
                deviceId: context.pkId,
                ...(encryptedText ? { message: encryptedText } : {}),
                ...(params.mediaPath ? { mediaPath: params.mediaPath } : {}),
                ...(params.fileName ? { fileName: params.fileName } : {}),
                contactId: contact?.pkId || null,
                isGroup: params.jid.includes('@g.us'),
                updatedAt: new Date(),
            },
            create: {
                id: params.messageId,
                waMessageId: params.messageId,
                to: params.jid,
                message: encryptedText,
                mediaPath: params.mediaPath || null,
                fileName: params.fileName || null,
                schedule: new Date(),
                status: 'server_ack',
                sessionId: context.sessionId,
                deviceId: context.pkId,
                contactId: contact?.pkId || null,
                isGroup: params.jid.includes('@g.us'),
                readBy: [],
            },
        });

        if (context.sessionId) {
            getSocketIO().to(`session:${context.sessionId}`).emit(`outgoing:${context.sessionId}`, {
                ...savedMessage,
                message: params.text || '',
                isOutgoing: true,
            });
        }

        if (
            !params.jid.endsWith('@lid') &&
            context.sessionId &&
            params.session &&
            typeof params.session.profilePictureUrl === 'function'
        ) {
            void refreshInboxProfileCache({
                deviceId: context.pkId,
                jid: params.jid,
                session: params.session,
            }).then((result) => {
                if (!result.hasImage) return;
                const profileUrl = createInboxProfileUrl(params.deviceId, params.jid);
                getSocketIO().to(`session:${context.sessionId}`).emit(
                    `incoming:${context.sessionId}:profile-updated`,
                    {
                        from: params.jid,
                        profilePicUrl: params.jid.includes('@g.us') ? null : profileUrl,
                        groupPicUrl: params.jid.includes('@g.us') ? profileUrl : null,
                        profilePictureStatus: result.status,
                        isGroup: params.jid.includes('@g.us'),
                    },
                );
            }).catch(() => undefined);
        }
    } catch (error) {
        // Pengiriman WhatsApp sudah sukses; kegagalan pencatatan tidak boleh
        // mengubah hasil kirim, tetapi harus terlihat jelas di log.
        logger.error(
            { error, deviceId: params.deviceId, jid: params.jid, messageId: params.messageId },
            '[MessageSender] Failed to persist outgoing message',
        );
    }
}

export interface SendMessageOptions {
    quoted?: any;
    messageId?: string;
    persist?: boolean;
    trackHealth?: boolean;
    /**
     * Explicitly resolve a personal PN JID to LID before sending.
     * Normal sends leave this disabled so Baileys can manage addressing and
     * its trusted-contact token lifecycle consistently.
     */
    resolveToLid?: boolean;
}

export interface SendMediaOptions extends SendMessageOptions {
    caption?: string;
    fileName?: string;
    mimetype?: string;
}

export interface SendResult {
    success: boolean;
    messageId?: string;
    result?: any;
    error?: string;
    errorCode?: string;
    statusCode?: number;
    rateLimitInfo?: RateLimitResult;
}

function createSendFailure(error: any, fallback: string): SendResult {
    return {
        success: false,
        error: error?.message || fallback,
        errorCode: typeof error?.code === 'string' ? error.code : undefined,
        statusCode: typeof error?.statusCode === 'number' ? error.statusCode : undefined,
    };
}

function isPersonalPhoneJid(jid: string): boolean {
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@hosted');
}

function isPersonalUserJid(jid: string): boolean {
    return (
        isPersonalPhoneJid(jid) ||
        jid.endsWith('@lid') ||
        jid.endsWith('@hosted.lid')
    );
}

function isProtocolMessageContent(content: any): boolean {
    return Boolean(
        content?.react ||
        content?.delete ||
        content?.edit ||
        content?.pin ||
        content?.keepInChat ||
        content?.protocolMessage,
    );
}

/**
 * Baileys 7 stores a PN <-> LID mapping for multi-device contacts. Sending to
 * the canonical LID avoids stale PN device fan-out for contacts that can
 * otherwise remain at SERVER_ACK even though their mapping already exists.
 *
 * The original PN JID remains the Inbox/database conversation key. If the
 * mapping is unavailable (or lookup fails), sending safely falls back to PN.
 */
export async function resolveCanonicalOutboundJid(
    session: any,
    jid: string,
    enabled = true,
): Promise<string> {
    if (!enabled || !isPersonalPhoneJid(jid)) return jid;

    try {
        const mappedJid = await session?.signalRepository?.lidMapping?.getLIDForPN?.(jid);
        if (
            typeof mappedJid === 'string' &&
            (mappedJid.endsWith('@lid') || mappedJid.endsWith('@hosted.lid'))
        ) {
            logger.debug(
                { sourceAddressing: 'pn', deliveryAddressing: 'lid' },
                '[MessageSender] Using canonical LID routing for personal message',
            );
            return mappedJid;
        }
    } catch (error) {
        logger.warn(
            { error: error instanceof Error ? error.message : 'LID lookup failed' },
            '[MessageSender] Canonical LID lookup failed; falling back to PN routing',
        );
    }

    return jid;
}

async function prepareOutboundJid(params: {
    session: any;
    deviceId: string;
    jid: string;
    resolveToLid: boolean;
    checkRecipientRestriction: boolean;
}): Promise<string> {
    const deliveryJid = await resolveCanonicalOutboundJid(
        params.session,
        params.jid,
        params.resolveToLid,
    );

    if (params.checkRecipientRestriction && isPersonalUserJid(params.jid)) {
        const context = await getDeviceContext(params.deviceId);
        if (!context?.sessionId) throw new Error('Session WhatsApp tidak ditemukan');
        await assertOutboundRecipientAvailable({
            devicePkId: context.pkId,
            sessionId: context.sessionId,
            jid: params.jid,
        });
    }

    return deliveryJid;
}

/**
 * Generate random delay untuk membuat pola lebih natural
 * Menambahkan jitter ke delay dasar
 */
function getRandomDelay(baseDelay: number): number {
    // Jitter antara -30% sampai +50% dari base delay
    const minMultiplier = 0.7;
    const maxMultiplier = 1.5;
    const multiplier = minMultiplier + Math.random() * (maxMultiplier - minMultiplier);
    return Math.floor(baseDelay * multiplier);
}

/**
 * Sleep dengan random jitter
 */
async function sleepWithJitter(baseMs: number): Promise<void> {
    const actualDelay = getRandomDelay(baseMs);
    return new Promise(resolve => setTimeout(resolve, actualDelay));
}

/**
 * Kirim pesan teks dengan rate limiting
 */
export async function sendTextMessage(
    session: any,
    deviceId: string,
    jid: string,
    text: string,
    options?: SendMessageOptions
): Promise<SendResult> {
    const taskId = options?.messageId || `text-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const { result, rateLimitInfo } = await executeWithRateLimit(
            deviceId,
            async () => {
                await assertDeviceCanSend(deviceId);
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;

                const deliveryJid = await prepareOutboundJid({
                    session,
                    deviceId,
                    jid,
                    resolveToLid: options?.resolveToLid === true && !options?.quoted,
                    checkRecipientRestriction: true,
                });
                return await session.sendMessage(deliveryJid, { text }, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        await persistOutgoingMessage({ deviceId, jid, messageId, text, session });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Text message sent'
        );

        return {
            success: true,
            messageId,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send text message'
        );
        return createSendFailure(error, 'Failed to send message');
    }
}

/**
 * Kirim pesan gambar dengan rate limiting
 */
export async function sendImageMessage(
    session: any,
    deviceId: string,
    jid: string,
    image: Buffer | { url: string },
    options?: SendMediaOptions
): Promise<SendResult> {
    const taskId = options?.messageId || `image-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const { result, rateLimitInfo } = await executeWithRateLimit(
            deviceId,
            async () => {
                await assertDeviceCanSend(deviceId);
                const message: any = { image };
                if (options?.caption) message.caption = options.caption;
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;

                const deliveryJid = await prepareOutboundJid({
                    session,
                    deviceId,
                    jid,
                    resolveToLid: options?.resolveToLid === true && !options?.quoted,
                    checkRecipientRestriction: true,
                });
                return await session.sendMessage(deliveryJid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        await persistOutgoingMessage({
            deviceId,
            jid,
            messageId,
            text: options?.caption || '[Gambar]',
            mediaPath: !Buffer.isBuffer(image) ? image.url : null,
            fileName: options?.fileName || null,
            session,
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Image message sent'
        );

        return {
            success: true,
            messageId,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send image message'
        );
        return createSendFailure(error, 'Failed to send image');
    }
}

/**
 * Kirim pesan dokumen dengan rate limiting
 */
export async function sendDocumentMessage(
    session: any,
    deviceId: string,
    jid: string,
    document: Buffer | { url: string },
    options?: SendMediaOptions
): Promise<SendResult> {
    const taskId = options?.messageId || `doc-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const { result, rateLimitInfo } = await executeWithRateLimit(
            deviceId,
            async () => {
                await assertDeviceCanSend(deviceId);
                const message: any = { 
                    document,
                    mimetype: options?.mimetype || 'application/octet-stream'
                };
                if (options?.caption) message.caption = options.caption;
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;

                const deliveryJid = await prepareOutboundJid({
                    session,
                    deviceId,
                    jid,
                    resolveToLid: options?.resolveToLid === true && !options?.quoted,
                    checkRecipientRestriction: true,
                });
                return await session.sendMessage(deliveryJid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        await persistOutgoingMessage({
            deviceId,
            jid,
            messageId,
            text: options?.caption || options?.fileName || '[Dokumen]',
            mediaPath: !Buffer.isBuffer(document) ? document.url : null,
            fileName: options?.fileName || null,
            session,
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Document message sent'
        );

        return {
            success: true,
            messageId,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send document message'
        );
        return createSendFailure(error, 'Failed to send document');
    }
}

/**
 * Kirim pesan video dengan rate limiting
 */
export async function sendVideoMessage(
    session: any,
    deviceId: string,
    jid: string,
    video: Buffer | { url: string },
    options?: SendMediaOptions
): Promise<SendResult> {
    const taskId = options?.messageId || `video-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const { result, rateLimitInfo } = await executeWithRateLimit(
            deviceId,
            async () => {
                await assertDeviceCanSend(deviceId);
                const message: any = { video };
                if (options?.caption) message.caption = options.caption;
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;

                const deliveryJid = await prepareOutboundJid({
                    session,
                    deviceId,
                    jid,
                    resolveToLid: options?.resolveToLid === true && !options?.quoted,
                    checkRecipientRestriction: true,
                });
                return await session.sendMessage(deliveryJid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        await persistOutgoingMessage({
            deviceId,
            jid,
            messageId,
            text: options?.caption || '[Video]',
            mediaPath: !Buffer.isBuffer(video) ? video.url : null,
            fileName: options?.fileName || null,
            session,
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Video message sent'
        );

        return {
            success: true,
            messageId,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send video message'
        );
        return createSendFailure(error, 'Failed to send video');
    }
}

/**
 * Kirim pesan audio dengan rate limiting
 */
export async function sendAudioMessage(
    session: any,
    deviceId: string,
    jid: string,
    audio: Buffer | { url: string },
    options?: SendMediaOptions
): Promise<SendResult> {
    const taskId = options?.messageId || `audio-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const { result, rateLimitInfo } = await executeWithRateLimit(
            deviceId,
            async () => {
                await assertDeviceCanSend(deviceId);
                const message: any = { 
                    audio,
                    mimetype: options?.mimetype || 'audio/mp4'
                };
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;

                const deliveryJid = await prepareOutboundJid({
                    session,
                    deviceId,
                    jid,
                    resolveToLid: options?.resolveToLid === true && !options?.quoted,
                    checkRecipientRestriction: true,
                });
                return await session.sendMessage(deliveryJid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        await persistOutgoingMessage({
            deviceId,
            jid,
            messageId,
            text: options?.fileName || '[Audio]',
            mediaPath: !Buffer.isBuffer(audio) ? audio.url : null,
            fileName: options?.fileName || null,
            session,
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Audio message sent'
        );

        return {
            success: true,
            messageId,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send audio message'
        );
        return createSendFailure(error, 'Failed to send audio');
    }
}

/**
 * Kirim media file generic (image/document/video/audio) dengan rate limiting
 * Deteksi otomatis berdasarkan tipe
 */
export async function sendMediaMessage(
    session: any,
    deviceId: string,
    jid: string,
    media: Buffer | { url: string },
    mediaType: 'image' | 'document' | 'video' | 'audio',
    options?: SendMediaOptions
): Promise<SendResult> {
    switch (mediaType) {
        case 'image':
            return sendImageMessage(session, deviceId, jid, media, options);
        case 'document':
            return sendDocumentMessage(session, deviceId, jid, media, options);
        case 'video':
            return sendVideoMessage(session, deviceId, jid, media, options);
        case 'audio':
            return sendAudioMessage(session, deviceId, jid, media, options);
        default:
            return sendDocumentMessage(session, deviceId, jid, media, options);
    }
}

/**
 * Kirim pesan dengan content generik (untuk backward compatibility)
 * Digunakan ketika message object sudah dibuat sebelumnya
 */
export async function sendGenericMessage(
    session: any,
    deviceId: string,
    jid: string,
    content: any,
    options?: SendMessageOptions
): Promise<SendResult> {
    const taskId = options?.messageId || `generic-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    
    try {
        const { result, rateLimitInfo } = await executeWithRateLimit(
            deviceId,
            async () => {
                await assertDeviceCanSend(deviceId);
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;

                const isProtocolMessage = isProtocolMessageContent(content);
                const deliveryJid = await prepareOutboundJid({
                    session,
                    deviceId,
                    jid,
                    resolveToLid:
                        options?.resolveToLid === true &&
                        !options?.quoted &&
                        !isProtocolMessage,
                    checkRecipientRestriction: !isProtocolMessage,
                });
                return await session.sendMessage(deliveryJid, content, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        const genericText =
            typeof content === 'string'
                ? content
                : content?.text || content?.caption || '[Pesan]';
        const genericMedia =
            content?.image?.url ||
            content?.document?.url ||
            content?.video?.url ||
            content?.audio?.url ||
            null;
        if (options?.persist !== false) {
            await persistOutgoingMessage({
                deviceId,
                jid,
                messageId,
                text: genericText,
                mediaPath: genericMedia,
                fileName: content?.fileName || null,
                session,
            });
        }
        
        // 🔥 Increment message count for health tracking
        if (options?.trackHealth !== false) {
            const devicePkId = await getDevicePkId(deviceId);
            if (devicePkId) {
                await incrementMessageCount(devicePkId);
            }
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Generic message sent'
        );

        return {
            success: true,
            messageId,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send generic message'
        );
        return createSendFailure(error, 'Failed to send message');
    }
}

/**
 * Batch send messages ke multiple recipients dengan rate limiting
 * Menambahkan random delay antar pesan untuk pola lebih natural
 */
export async function sendBatchMessages(
    session: any,
    deviceId: string,
    recipients: string[],
    messageFactory: (recipient: string) => { content: any; options?: SendMessageOptions },
    baseDelayMs: number = 3000
): Promise<{ results: SendResult[]; errors: SendResult[] }> {
    const results: SendResult[] = [];
    const errors: SendResult[] = [];

    for (let i = 0; i < recipients.length; i++) {
        const recipient = recipients[i];
        const { content, options } = messageFactory(recipient);
        
        try {
            const result = await sendGenericMessage(session, deviceId, recipient, content, options);
            
            if (result.success) {
                results.push(result);
            } else {
                errors.push(result);
            }

            // Tambah delay dengan jitter antara pesan (kecuali pesan terakhir)
            if (i < recipients.length - 1) {
                await sleepWithJitter(baseDelayMs);
            }
        } catch (error: any) {
            errors.push({
                success: false,
                error: error.message || 'Unknown error'
            });
        }
    }

    logger.info(
        { deviceId, total: recipients.length, success: results.length, failed: errors.length },
        '[MessageSender] Batch send completed'
    );

    return { results, errors };
}

/**
 * Helper untuk menentukan tipe media dari path/extension
 */
export function detectMediaType(filePath: string): 'image' | 'document' | 'video' | 'audio' {
    const ext = filePath.split('.').pop()?.toLowerCase() || '';
    
    const imageExts = ['jpg', 'jpeg', 'png', 'gif', 'webp'];
    const videoExts = ['mp4', 'avi', 'mov', 'mkv', '3gp'];
    const audioExts = ['mp3', 'wav', 'ogg', 'm4a', 'aac'];
    
    if (imageExts.includes(ext)) return 'image';
    if (videoExts.includes(ext)) return 'video';
    if (audioExts.includes(ext)) return 'audio';
    return 'document';
}

// Export semua functions
export default {
    sendTextMessage,
    sendImageMessage,
    sendDocumentMessage,
    sendVideoMessage,
    sendAudioMessage,
    sendMediaMessage,
    sendGenericMessage,
    sendBatchMessages,
    detectMediaType
};
