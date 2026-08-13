// filepath: d:\Doc\autosender\forwardin\src\services\messageSender.ts
/* eslint-disable @typescript-eslint/no-explicit-any */
import { executeWithRateLimit, RateLimitResult } from './rateLimiter';
import { canDeviceSend, incrementMessageCount } from './signalDetector';
import prisma from '../utils/db';
import logger from '../config/logger';
import { decryptMessage, encryptMessage } from '../utils/messageEncryption';
import { getSocketIO } from '../socket';
import { createInboxProfileUrl } from '../utils/inboxMedia';
import { refreshInboxProfileCache } from './inboxProfileCache';
import { createTrackedMessageId } from '../utils/outgoingMessageId';

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

async function persistPendingOutgoingMessage(params: {
    deviceId: string;
    jid: string;
    messageId?: string;
    text?: string;
    mediaPath?: string | null;
    fileName?: string | null;
    session?: any;
}): Promise<boolean> {
    if (!params.messageId) return true;

    const context = await getDeviceContext(params.deviceId);
    if (!context) {
        throw new Error('Device tidak ditemukan');
    }

    const findExistingReservation = async () => {
        const existing = await prisma.outgoingMessage.findUnique({
            where: { id: params.messageId! },
        });
        if (!existing) return null;

        let existingText: string | null = null;
        try {
            existingText = existing.message ? decryptMessage(existing.message) : null;
        } catch {
            existingText = null;
        }

        const requestedText = params.text || null;
        const sameRequest =
            existing.deviceId === context.pkId &&
            existing.sessionId === context.sessionId &&
            existing.to === params.jid &&
            existingText === requestedText &&
            (params.fileName == null || existing.fileName === params.fileName) &&
            (params.mediaPath == null || existing.mediaPath === params.mediaPath);

        if (!sameRequest) {
            const conflict = new Error(
                'ID pesan sudah digunakan untuk permintaan pengiriman yang berbeda.',
            ) as Error & { code?: string; statusCode?: number };
            conflict.code = 'MESSAGE_ID_CONFLICT';
            conflict.statusCode = 409;
            throw conflict;
        }

        return existing;
    };

    if (await findExistingReservation()) {
        logger.info(
            { deviceId: params.deviceId, messageId: params.messageId },
            '[MessageSender] Reusing idempotent outgoing-message reservation',
        );
        return false;
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

    let savedMessage;
    try {
        savedMessage = await prisma.outgoingMessage.create({
            data: {
                id: params.messageId,
                waMessageId: params.messageId,
                to: params.jid,
                message: encryptedText,
                mediaPath: params.mediaPath || null,
                fileName: params.fileName || null,
                schedule: new Date(),
                status: 'pending',
                sessionId: context.sessionId,
                deviceId: context.pkId,
                contactId: contact?.pkId || null,
                isGroup: params.jid.includes('@g.us'),
                readBy: [],
            },
        });
    } catch (error) {
        if ((error as { code?: unknown })?.code !== 'P2002') throw error;
        if (!(await findExistingReservation())) throw error;
        logger.info(
            { deviceId: params.deviceId, messageId: params.messageId },
            '[MessageSender] Concurrent duplicate send reused existing reservation',
        );
        return false;
    }

    try {
        if (context.sessionId) {
            getSocketIO().to(`session:${context.sessionId}`).emit(`outgoing:${context.sessionId}`, {
                ...savedMessage,
                message: params.text || '',
                isOutgoing: true,
            });
        }
    } catch (error) {
        // Tracking is already durable. A notification failure must not turn a
        // successfully reserved message into an untracked send failure.
        logger.warn(
            { error, messageId: params.messageId, sessionId: context.sessionId },
            '[MessageSender] Failed to emit pending outgoing message',
        );
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

    return true;
}

async function markPendingOutgoingMessageAsFailed(messageId: string): Promise<void> {
    await prisma.outgoingMessage.updateMany({
        where: { id: messageId, status: 'pending' },
        data: { status: 'error', updatedAt: new Date() },
    });
}

export function resolveTrackedOutboundMessageId(session: any, requestedId?: string): string {
    return requestedId || createTrackedMessageId(undefined, session?.user?.id);
}

/**
 * Keep reservation/send ordering in one place so every public sender has a
 * durable pending row before WhatsApp can emit a fast ACK or NACK.
 */
export async function runWithPendingOutgoingMessage<T>(params: {
    persist: boolean;
    reserve: () => Promise<boolean | void>;
    send: () => Promise<T>;
    markFailed: () => Promise<void>;
    onDuplicate?: () => Promise<T> | T;
}): Promise<T> {
    let reserved = false;
    try {
        if (params.persist) {
            const reservationCreated = await params.reserve();
            if (reservationCreated === false) {
                if (!params.onDuplicate) {
                    throw new Error('Duplicate outgoing-message reservation');
                }
                return await params.onDuplicate();
            }
            reserved = true;
        }
        return await params.send();
    } catch (error) {
        if (reserved) {
            try {
                await params.markFailed();
            } catch (markError) {
                logger.error(
                    { error: markError },
                    '[MessageSender] Failed to mark pending outgoing message as error',
                );
            }
        }
        throw error;
    }
}

export interface SendMessageOptions {
    quoted?: any;
    messageId?: string;
    persist?: boolean;
    trackHealth?: boolean;
    /**
     * Resolve a personal phone-number JID to its canonical LID before delivery.
     * Disable this for operations that must keep the exact addressing of an
     * existing message (for example protocol actions or quoted replies).
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
    idempotent?: boolean;
    result?: any;
    error?: string;
    errorCode?: string;
    statusCode?: number;
    rateLimitInfo?: RateLimitResult;
}

type TrackedSendExecution = {
    result: any;
    rateLimitInfo: RateLimitResult;
    idempotent?: boolean;
};

function createIdempotentExecution(messageId: string, jid: string): TrackedSendExecution {
    return {
        result: {
            key: { id: messageId, remoteJid: jid, fromMe: true },
            idempotent: true,
        },
        rateLimitInfo: {
            allowed: true,
            delayed: false,
            delayMs: 0,
            estimatedSendTime: new Date(),
            queuePosition: 0,
            message: 'Permintaan duplikat menggunakan hasil pengiriman yang sama',
        },
        idempotent: true,
    };
}

export function assertReturnedMessageId(result: any, expectedMessageId: string): void {
    const returnedMessageId = result?.key?.id;
    if (returnedMessageId === expectedMessageId) return;

    const error = new Error(
        returnedMessageId
            ? 'WhatsApp mengembalikan ID pesan yang berbeda dari ID pelacakan.'
            : 'WhatsApp tidak mengembalikan ID pesan untuk pelacakan.',
    ) as Error & { code?: string; statusCode?: number };
    error.code = 'WHATSAPP_MESSAGE_ID_MISMATCH';
    error.statusCode = 502;
    throw error;
}

async function sendTrackedMessage(
    session: any,
    jid: string,
    content: any,
    sendOptions: any,
    messageId: string,
): Promise<any> {
    const result = await session.sendMessage(jid, content, sendOptions);
    assertReturnedMessageId(result, messageId);
    return result;
}

function isPersonalPhoneJid(jid: string): boolean {
    return jid.endsWith('@s.whatsapp.net') || jid.endsWith('@hosted');
}

function isCanonicalLidJid(jid: unknown): jid is string {
    return (
        typeof jid === 'string' &&
        /^[^@\s]+@(lid|hosted\.lid)$/.test(jid)
    );
}

function isProtocolMessageContent(content: any): boolean {
    if (!content || typeof content !== 'object') return false;

    return Boolean(
        content.react ||
        content.delete ||
        content.edit ||
        content.pin ||
        content.keepInChat ||
        content.protocolMessage ||
        Object.prototype.hasOwnProperty.call(content, 'disappearingMessagesInChat') ||
        Object.prototype.hasOwnProperty.call(content, 'limitSharing') ||
        Object.prototype.hasOwnProperty.call(content, 'sharePhoneNumber')
    );
}

type SessionSendReadiness = {
    ready: boolean;
    code?: string;
    message?: string;
    statusCode?: number;
    retryAt?: string;
};

export function assertOutboundSessionReady(session: any, jid?: string): void {
    const readiness: SessionSendReadiness | undefined =
        typeof session?.getSendReadiness === 'function'
            ? session.getSendReadiness(jid)
            : undefined;

    if (readiness?.ready === false) {
        const error = new Error(
            readiness.message || 'Sesi WhatsApp belum siap mengirim pesan',
        ) as Error & { code?: string; statusCode?: number; retryAt?: string };
        error.code = readiness.code || 'WHATSAPP_SESSION_NOT_READY';
        error.statusCode = readiness.statusCode || 503;
        error.retryAt = readiness.retryAt;
        throw error;
    }

    // Compatibility fallback for raw Baileys sockets that do not carry the
    // generation-aware readiness probe installed by whatsapp.ts.
    if (!readiness && (!session?.user || session?.ws?.readyState !== 1)) {
        const error = new Error(
            'Sesi WhatsApp sedang tidak terhubung atau menyambung ulang.',
        ) as Error & { code?: string; statusCode?: number };
        error.code = 'WHATSAPP_SESSION_NOT_READY';
        error.statusCode = 503;
        throw error;
    }
}

function shouldGuardRecipientCooldown(
    jid: string,
    content?: any,
): boolean {
    return (
        !jid.endsWith('@g.us') &&
        !jid.endsWith('@newsletter') &&
        !isProtocolMessageContent(content)
    );
}

async function prepareOutboundDeliveryJid(
    session: any,
    jid: string,
    options?: SendMessageOptions,
    content?: any,
): Promise<string> {
    const guardRecipient = shouldGuardRecipientCooldown(jid, content);
    assertOutboundSessionReady(session, guardRecipient ? jid : undefined);

    const deliveryJid = await resolveCanonicalOutboundJid(
        session,
        jid,
        shouldUseCanonicalOutboundRouting(jid, options, content),
    );

    // Mapping and other pre-send work can await I/O. Re-check the active socket
    // generation immediately before handing the stanza to Baileys.
    assertOutboundSessionReady(session, guardRecipient ? deliveryJid : undefined);
    return deliveryJid;
}

/**
 * Decide whether a send may use canonical PN -> LID routing.
 *
 * New one-to-one messages opt in by default. Address-bound operations keep the
 * original JID so their message keys and quoted context remain consistent.
 */
export function shouldUseCanonicalOutboundRouting(
    jid: string,
    options?: SendMessageOptions,
    content?: any,
): boolean {
    return (
        isPersonalPhoneJid(jid) &&
        options?.resolveToLid !== false &&
        !options?.quoted &&
        !isProtocolMessageContent(content)
    );
}

/**
 * Resolve a personal PN JID through Baileys' stored PN/LID mapping.
 * Missing, invalid, or failed lookups safely fall back to the original JID.
 */
export async function resolveCanonicalOutboundJid(
    session: any,
    jid: string,
    enabled = true,
): Promise<string> {
    if (!enabled || !isPersonalPhoneJid(jid)) return jid;

    try {
        const mappedJid = await session?.signalRepository?.lidMapping?.getLIDForPN?.(jid);
        if (isCanonicalLidJid(mappedJid)) {
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

function createSendFailure(error: any, fallback: string, messageId?: string): SendResult {
    return {
        success: false,
        messageId,
        error: error?.message || fallback,
        errorCode: typeof error?.code === 'string' ? error.code : undefined,
        statusCode: typeof error?.statusCode === 'number' ? error.statusCode : undefined,
    };
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
    const messageId = resolveTrackedOutboundMessageId(session, options?.messageId);
    const taskId = messageId;
    
    try {
        const { result, rateLimitInfo, idempotent } =
            await runWithPendingOutgoingMessage<TrackedSendExecution>({
            persist: options?.persist !== false,
            reserve: () => persistPendingOutgoingMessage({
                deviceId,
                jid,
                messageId,
                text,
                session,
            }),
            markFailed: () => markPendingOutgoingMessageAsFailed(messageId),
            onDuplicate: () => createIdempotentExecution(messageId, jid),
            send: () => executeWithRateLimit(
                deviceId,
                async () => {
                    await assertDeviceCanSend(deviceId);
                    const sendOptions: any = { messageId };
                    if (options?.quoted) sendOptions.quoted = options.quoted;

                    const deliveryJid = await prepareOutboundDeliveryJid(
                        session,
                        jid,
                        options,
                    );
                    return sendTrackedMessage(
                        session,
                        deliveryJid,
                        { text },
                        sendOptions,
                        messageId,
                    );
                },
                taskId,
            ),
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId && !idempotent) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Text message sent'
        );

        return {
            success: true,
            messageId,
            idempotent,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send text message'
        );
        return createSendFailure(error, 'Failed to send message', messageId);
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
    const messageId = resolveTrackedOutboundMessageId(session, options?.messageId);
    const taskId = messageId;
    
    try {
        const { result, rateLimitInfo, idempotent } =
            await runWithPendingOutgoingMessage<TrackedSendExecution>({
            persist: options?.persist !== false,
            reserve: () => persistPendingOutgoingMessage({
                deviceId,
                jid,
                messageId,
                text: options?.caption || '[Gambar]',
                mediaPath: !Buffer.isBuffer(image) ? image.url : null,
                fileName: options?.fileName || null,
                session,
            }),
            markFailed: () => markPendingOutgoingMessageAsFailed(messageId),
            onDuplicate: () => createIdempotentExecution(messageId, jid),
            send: () => executeWithRateLimit(
                deviceId,
                async () => {
                    await assertDeviceCanSend(deviceId);
                    const message: any = { image };
                    if (options?.caption) message.caption = options.caption;
                    if (options?.fileName) message.fileName = options.fileName;

                    const sendOptions: any = { messageId };
                    if (options?.quoted) sendOptions.quoted = options.quoted;

                    const deliveryJid = await prepareOutboundDeliveryJid(
                        session,
                        jid,
                        options,
                        message,
                    );
                    return sendTrackedMessage(
                        session,
                        deliveryJid,
                        message,
                        sendOptions,
                        messageId,
                    );
                },
                taskId,
            ),
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId && !idempotent) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Image message sent'
        );

        return {
            success: true,
            messageId,
            idempotent,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send image message'
        );
        return createSendFailure(error, 'Failed to send image', messageId);
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
    const messageId = resolveTrackedOutboundMessageId(session, options?.messageId);
    const taskId = messageId;
    
    try {
        const { result, rateLimitInfo, idempotent } =
            await runWithPendingOutgoingMessage<TrackedSendExecution>({
            persist: options?.persist !== false,
            reserve: () => persistPendingOutgoingMessage({
                deviceId,
                jid,
                messageId,
                text: options?.caption || options?.fileName || '[Dokumen]',
                mediaPath: !Buffer.isBuffer(document) ? document.url : null,
                fileName: options?.fileName || null,
                session,
            }),
            markFailed: () => markPendingOutgoingMessageAsFailed(messageId),
            onDuplicate: () => createIdempotentExecution(messageId, jid),
            send: () => executeWithRateLimit(
                deviceId,
                async () => {
                    await assertDeviceCanSend(deviceId);
                    const message: any = {
                        document,
                        mimetype: options?.mimetype || 'application/octet-stream'
                    };
                    if (options?.caption) message.caption = options.caption;
                    if (options?.fileName) message.fileName = options.fileName;

                    const sendOptions: any = { messageId };
                    if (options?.quoted) sendOptions.quoted = options.quoted;

                    const deliveryJid = await prepareOutboundDeliveryJid(
                        session,
                        jid,
                        options,
                        message,
                    );
                    return sendTrackedMessage(
                        session,
                        deliveryJid,
                        message,
                        sendOptions,
                        messageId,
                    );
                },
                taskId,
            ),
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId && !idempotent) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Document message sent'
        );

        return {
            success: true,
            messageId,
            idempotent,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send document message'
        );
        return createSendFailure(error, 'Failed to send document', messageId);
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
    const messageId = resolveTrackedOutboundMessageId(session, options?.messageId);
    const taskId = messageId;
    
    try {
        const { result, rateLimitInfo, idempotent } =
            await runWithPendingOutgoingMessage<TrackedSendExecution>({
            persist: options?.persist !== false,
            reserve: () => persistPendingOutgoingMessage({
                deviceId,
                jid,
                messageId,
                text: options?.caption || '[Video]',
                mediaPath: !Buffer.isBuffer(video) ? video.url : null,
                fileName: options?.fileName || null,
                session,
            }),
            markFailed: () => markPendingOutgoingMessageAsFailed(messageId),
            onDuplicate: () => createIdempotentExecution(messageId, jid),
            send: () => executeWithRateLimit(
                deviceId,
                async () => {
                    await assertDeviceCanSend(deviceId);
                    const message: any = { video };
                    if (options?.caption) message.caption = options.caption;
                    if (options?.fileName) message.fileName = options.fileName;

                    const sendOptions: any = { messageId };
                    if (options?.quoted) sendOptions.quoted = options.quoted;

                    const deliveryJid = await prepareOutboundDeliveryJid(
                        session,
                        jid,
                        options,
                        message,
                    );
                    return sendTrackedMessage(
                        session,
                        deliveryJid,
                        message,
                        sendOptions,
                        messageId,
                    );
                },
                taskId,
            ),
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId && !idempotent) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Video message sent'
        );

        return {
            success: true,
            messageId,
            idempotent,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send video message'
        );
        return createSendFailure(error, 'Failed to send video', messageId);
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
    const messageId = resolveTrackedOutboundMessageId(session, options?.messageId);
    const taskId = messageId;
    
    try {
        const { result, rateLimitInfo, idempotent } =
            await runWithPendingOutgoingMessage<TrackedSendExecution>({
            persist: options?.persist !== false,
            reserve: () => persistPendingOutgoingMessage({
                deviceId,
                jid,
                messageId,
                text: options?.fileName || '[Audio]',
                mediaPath: !Buffer.isBuffer(audio) ? audio.url : null,
                fileName: options?.fileName || null,
                session,
            }),
            markFailed: () => markPendingOutgoingMessageAsFailed(messageId),
            onDuplicate: () => createIdempotentExecution(messageId, jid),
            send: () => executeWithRateLimit(
                deviceId,
                async () => {
                    await assertDeviceCanSend(deviceId);
                    const message: any = {
                        audio,
                        mimetype: options?.mimetype || 'audio/mp4'
                    };
                    if (options?.fileName) message.fileName = options.fileName;

                    const sendOptions: any = { messageId };
                    if (options?.quoted) sendOptions.quoted = options.quoted;

                    const deliveryJid = await prepareOutboundDeliveryJid(
                        session,
                        jid,
                        options,
                        message,
                    );
                    return sendTrackedMessage(
                        session,
                        deliveryJid,
                        message,
                        sendOptions,
                        messageId,
                    );
                },
                taskId,
            ),
        });
        
        // 🔥 Increment message count for health tracking
        const devicePkId = await getDevicePkId(deviceId);
        if (devicePkId && !idempotent) {
            await incrementMessageCount(devicePkId);
        }
        
        logger.info(
            { deviceId, jid, messageId, delayed: rateLimitInfo.delayed },
            '[MessageSender] Audio message sent'
        );

        return {
            success: true,
            messageId,
            idempotent,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send audio message'
        );
        return createSendFailure(error, 'Failed to send audio', messageId);
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
    const messageId = resolveTrackedOutboundMessageId(session, options?.messageId);
    const taskId = messageId;
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
    
    try {
        const { result, rateLimitInfo, idempotent } =
            await runWithPendingOutgoingMessage<TrackedSendExecution>({
            persist: options?.persist !== false,
            reserve: () => persistPendingOutgoingMessage({
                deviceId,
                jid,
                messageId,
                text: genericText,
                mediaPath: genericMedia,
                fileName: content?.fileName || null,
                session,
            }),
            markFailed: () => markPendingOutgoingMessageAsFailed(messageId),
            onDuplicate: () => createIdempotentExecution(messageId, jid),
            send: () => executeWithRateLimit(
                deviceId,
                async () => {
                    await assertDeviceCanSend(deviceId);
                    const sendOptions: any = { messageId };
                    if (options?.quoted) sendOptions.quoted = options.quoted;

                    const deliveryJid = await prepareOutboundDeliveryJid(
                        session,
                        jid,
                        options,
                        content,
                    );
                    return sendTrackedMessage(
                        session,
                        deliveryJid,
                        content,
                        sendOptions,
                        messageId,
                    );
                },
                taskId,
            ),
        });
        
        // 🔥 Increment message count for health tracking
        if (options?.trackHealth !== false && !idempotent) {
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
            idempotent,
            result,
            rateLimitInfo
        };
    } catch (error: any) {
        logger.error(
            { error: error.message, deviceId, jid },
            '[MessageSender] Failed to send generic message'
        );
        return createSendFailure(error, 'Failed to send message', messageId);
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
