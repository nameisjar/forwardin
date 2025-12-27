// filepath: d:\Doc\autosender\forwardin\src\services\messageSender.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { proto } from '@whiskeysockets/baileys';
import { executeWithRateLimit, RateLimitResult } from './rateLimiter';
import { incrementMessageCount } from './signalDetector';
import prisma from '../utils/db';
import logger from '../config/logger';

// ============================================
// 🚀 MESSAGE SENDER SERVICE
// ============================================
// 
// Wrapper untuk semua pengiriman pesan WhatsApp
// dengan integrasi Rate Limiter untuk mencegah ban.
//
// SEMUA pengiriman pesan HARUS melalui service ini!
// ============================================

// Cache deviceId -> pkId untuk mengurangi query DB
const devicePkIdCache = new Map<string, number>();

/**
 * Get device pkId from deviceId (UUID) with caching
 */
async function getDevicePkId(deviceId: string): Promise<number | null> {
    // Check cache first
    if (devicePkIdCache.has(deviceId)) {
        return devicePkIdCache.get(deviceId)!;
    }
    
    // Query DB
    const device = await prisma.device.findUnique({
        where: { id: deviceId },
        select: { pkId: true }
    });
    
    if (device) {
        devicePkIdCache.set(deviceId, device.pkId);
        return device.pkId;
    }
    
    return null;
}

export interface SendMessageOptions {
    quoted?: any;
    messageId?: string;
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
    rateLimitInfo?: RateLimitResult;
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
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;
                
                return await session.sendMessage(jid, { text }, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        
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
        return {
            success: false,
            error: error.message || 'Failed to send message'
        };
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
                const message: any = { image };
                if (options?.caption) message.caption = options.caption;
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;
                
                return await session.sendMessage(jid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        
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
        return {
            success: false,
            error: error.message || 'Failed to send image'
        };
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
                const message: any = { 
                    document,
                    mimetype: options?.mimetype || 'application/octet-stream'
                };
                if (options?.caption) message.caption = options.caption;
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;
                
                return await session.sendMessage(jid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        
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
        return {
            success: false,
            error: error.message || 'Failed to send document'
        };
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
                const message: any = { video };
                if (options?.caption) message.caption = options.caption;
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;
                
                return await session.sendMessage(jid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        
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
        return {
            success: false,
            error: error.message || 'Failed to send video'
        };
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
                const message: any = { 
                    audio,
                    mimetype: options?.mimetype || 'audio/mp4'
                };
                if (options?.fileName) message.fileName = options.fileName;
                
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;
                
                return await session.sendMessage(jid, message, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        
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
        return {
            success: false,
            error: error.message || 'Failed to send audio'
        };
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
                const sendOptions: any = {};
                if (options?.quoted) sendOptions.quoted = options.quoted;
                if (options?.messageId) sendOptions.messageId = options.messageId;
                
                return await session.sendMessage(jid, content, sendOptions);
            },
            taskId
        );

        const messageId = result?.key?.id;
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId) {
            await incrementMessageCount(devicePkId);
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
        return {
            success: false,
            error: error.message || 'Failed to send message'
        };
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
