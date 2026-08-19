/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
    BaileysEventEmitter,
    MessageUserReceipt,
    proto,
    WAMessageKey,
} from '@whiskeysockets/baileys';
import {
    downloadContentFromMessage,
    downloadMediaMessage,
    extractMessageContent,
    getMediaKeys,
    getUrlFromDirectPath,
    jidNormalizedUser,
} from '@whiskeysockets/baileys';
import logger from '../config/logger';
import prisma, { transformPrisma } from '../utils/db';
import { BaileysEventHandler } from '../types';
import { sendCampaignReply } from '../controllers/campaign';
import { sendOutsideBusinessHourMessage } from '../controllers/businessHour';
import fs from 'fs';
import path from 'path';
import { getSocketIO } from '../socket';
import { Server } from 'socket.io';
import {
    describePayloadShape,
    safeMessageContext,
    redactPhone,
    redactMessageObject,
} from '../utils/logRedaction';
import {
    decryptIncomingMessage,
    encryptMessage,
    decryptOutgoingMessage,
} from '../utils/messageEncryption';
import { getInstance } from '../whatsapp';
import sharp from 'sharp';
import axios from 'axios';
import https from 'https';
import { createDecipheriv } from 'crypto';
import {
    createInboxProfileUrl,
    resolveInboxMediaType,
    serializeInboxMediaPath,
} from '../utils/inboxMedia';
import { refreshInboxProfileCache } from '../services/inboxProfileCache';
import {
    deleteReactionPlaceholder,
    reactionTimestamp,
    saveMessageReaction,
} from '../services/messageReaction';
import {
    canApplyOutgoingMessageStatus,
    eligibleOutgoingMessageStatuses,
    outgoingMessageStatusLevel,
    resolveParticipantReceiptStatus,
} from '../utils/outgoingMessageStatus';
import {
    extractMessageEditEnvelope,
    isMessageEditEnvelope,
} from '../utils/messageEdit';
import { applyIncomingMessageEdit } from '../services/incomingMessageEdit';
import {
    applySecretIncomingMessageEdit,
    saveIncomingMessageSecret,
} from '../services/incomingMessageSecret';
import { resolveIncomingQuoteMetadata } from '../services/inboxMessageQuote';

const whatsappMediaHttpsAgent = new https.Agent({
    family: 4,
    keepAlive: true,
    maxSockets: 20,
});

const inboxContactLabelInclude = {
    ContactLabel: {
        select: {
            label: {
                select: { name: true },
            },
        },
    },
} as const;

// Baileys can replay the same messages.upsert item during reconnects or emit it
// through more than one upsert batch. Persistence is already idempotent, but a
// repeated socket emission would still create duplicate browser notifications.
const INCOMING_EVENT_DEDUP_TTL_MS = 10 * 60 * 1000;
const MAX_RECENT_INCOMING_EVENTS = 10_000;
const recentIncomingSocketEvents = new Map<string, number>();

const shouldEmitIncomingSocketEvent = (
    sessionId: string,
    messageId: string,
    now = Date.now(),
) => {
    const key = `${sessionId}:${messageId}`;
    const expiresAt = recentIncomingSocketEvents.get(key);
    if (expiresAt && expiresAt > now) return false;

    recentIncomingSocketEvents.set(key, now + INCOMING_EVENT_DEDUP_TTL_MS);

    if (recentIncomingSocketEvents.size > MAX_RECENT_INCOMING_EVENTS) {
        for (const [recentKey, recentExpiresAt] of recentIncomingSocketEvents) {
            if (recentExpiresAt <= now) recentIncomingSocketEvents.delete(recentKey);
        }
        while (recentIncomingSocketEvents.size > MAX_RECENT_INCOMING_EVENTS) {
            const oldestKey = recentIncomingSocketEvents.keys().next().value;
            if (!oldestKey) break;
            recentIncomingSocketEvents.delete(oldestKey);
        }
    }

    return true;
};

// Baileys and the application currently resolve different generations of the
// Node Buffer declarations. Copy binary values at API boundaries so Node's
// newer crypto/fs types always receive a plain ArrayBuffer-backed view.
const copyToNativeUint8Array = (value: ArrayLike<number>) => {
    const copy = new Uint8Array(value.length);
    copy.set(value);
    return copy;
};

async function downloadWhatsAppMediaOverIpv4(
    media: {
        mediaKey?: Uint8Array | null;
        directPath?: string | null;
        url?: string | null;
    },
    mediaType: any,
): Promise<Buffer> {
    if (!media.mediaKey || (!media.directPath && !media.url)) {
        throw new Error('WhatsApp media descriptor is incomplete');
    }

    const downloadUrl = media.url?.startsWith('https://mmg.whatsapp.net/')
        ? media.url
        : getUrlFromDirectPath(media.directPath!);
    const response = await axios.get<ArrayBuffer>(downloadUrl, {
        responseType: 'arraybuffer',
        timeout: 30_000,
        maxContentLength: 50 * 1024 * 1024,
        maxBodyLength: 50 * 1024 * 1024,
        httpsAgent: whatsappMediaHttpsAgent,
        headers: {
            Accept: '*/*',
            Origin: 'https://web.whatsapp.com',
            'User-Agent': 'Mozilla/5.0',
        },
    });
    // Axios returns a Node Buffer at runtime for arraybuffer responses, while
    // newer TypeScript/Node declarations model this as ArrayBuffer. Copy via a
    // native Uint8Array so both declaration variants remain compatible.
    const encryptedPayload = Buffer.from(new Uint8Array(response.data));
    if (encryptedPayload.length <= 10) {
        throw new Error('WhatsApp CDN returned an empty encrypted payload');
    }

    // WhatsApp appends a 10-byte MAC after the AES-CBC ciphertext.
    const ciphertext = encryptedPayload.subarray(0, encryptedPayload.length - 10);
    const { cipherKey, iv } = await getMediaKeys(media.mediaKey, mediaType);
    // Allocate fresh typed arrays backed by a plain ArrayBuffer. Baileys can
    // expose Uint8Array<ArrayBufferLike>, while newer Node crypto declarations
    // require an ArrayBuffer-backed view and reject Buffer/SharedArrayBuffer.
    const cipherKeyBytes = copyToNativeUint8Array(cipherKey);
    const ivBytes = copyToNativeUint8Array(iv);
    const decipher = createDecipheriv('aes-256-cbc', cipherKeyBytes, ivBytes);
    const decrypted = copyToNativeUint8Array(
        decipher.update(copyToNativeUint8Array(ciphertext)),
    );
    const finalBlock = copyToNativeUint8Array(decipher.final());
    const plaintext = new Uint8Array(decrypted.length + finalBlock.length);
    plaintext.set(decrypted);
    plaintext.set(finalBlock, decrypted.length);
    return Buffer.from(plaintext);
}

const getKeyAuthor = (key: WAMessageKey | undefined | null) =>
    (key?.fromMe
        ? 'me'
        : key?.participantAlt || key?.remoteJidAlt || key?.participant || key?.remoteJid) || '';

const getPhoneJid = (...jids: Array<string | null | undefined>): string | null => {
    const phoneJid = jids.find((candidate) => candidate?.endsWith('@s.whatsapp.net'));
    return phoneJid ? jidNormalizedUser(phoneJid) : null;
};

export default function messageHandler(sessionId: string, event: BaileysEventEmitter, deviceId?: number) {
    let listening = false;
    let deviceUuidPromise: Promise<string | null> | null = null;
    let devicePkIdPromise: Promise<number | null> | null = null;
    const getDeviceUuid = () => {
        if (!deviceId) return Promise.resolve(null);
        if (!deviceUuidPromise) {
            deviceUuidPromise = prisma.device
                .findUnique({ where: { pkId: deviceId }, select: { id: true } })
                .then((device) => device?.id || null);
        }
        return deviceUuidPromise;
    };
    const getDevicePkId = () => {
        if (deviceId) return Promise.resolve(deviceId);
        if (!devicePkIdPromise) {
            devicePkIdPromise = prisma.session
                .findFirst({ where: { sessionId }, select: { deviceId: true } })
                .then((session) => session?.deviceId || null);
        }
        return devicePkIdPromise;
    };
    const emitOutgoingStatus = async (payload: Record<string, unknown>) => {
        const publicDeviceUuid = await getDeviceUuid();
        if (!publicDeviceUuid) return false;

        getSocketIO()
            .to(`session:${sessionId}`)
            .emit(`device:${publicDeviceUuid}:message-status`, payload);
        return true;
    };

    const persistReaction = async (
        targetKey: WAMessageKey,
        reaction: proto.IReaction,
        conversationJidOverride?: string,
    ) => {
        if (!targetKey.id) return null;

        const reactionDeviceId = await getDevicePkId();
        if (!reactionDeviceId) return null;

        const targetRemoteJid = targetKey.remoteJid || conversationJidOverride;
        if (!targetRemoteJid) return null;

        let conversationJid = targetRemoteJid.endsWith('@g.us')
            ? jidNormalizedUser(targetRemoteJid)
            : getPhoneJid(
                  targetRemoteJid,
                  targetKey.remoteJidAlt,
                  conversationJidOverride,
              ) || jidNormalizedUser(targetRemoteJid);
        const persistedTarget = targetKey.fromMe
            ? await prisma.outgoingMessage.findFirst({
                  where: {
                      deviceId: reactionDeviceId,
                      OR: [
                          { waMessageId: targetKey.id },
                          { id: targetKey.id },
                      ],
                  },
                  select: { to: true },
              })
            : await prisma.incomingMessage.findFirst({
                  where: { deviceId: reactionDeviceId, id: targetKey.id },
                  select: { from: true },
              });
        const persistedConversationJid = persistedTarget
            ? ('to' in persistedTarget ? persistedTarget.to : persistedTarget.from)
            : null;
        if (persistedConversationJid && !persistedConversationJid.endsWith('@lid')) {
            conversationJid = persistedConversationJid;
        }
        const isGroup = conversationJid.endsWith('@g.us');
        const reactionKey = reaction.key as WAMessageKey | null | undefined;
        const reactorJid = reactionKey?.fromMe
            ? 'me'
            : isGroup
              ? getPhoneJid(
                    reactionKey?.participant,
                    reactionKey?.participantAlt,
                ) || reactionKey?.participant || conversationJid
              : conversationJid;

        const saved = await saveMessageReaction({
            deviceId: reactionDeviceId,
            sessionId,
            conversationJid,
            targetMessageId: targetKey.id,
            targetFromMe: Boolean(targetKey.fromMe),
            reactorJid,
            emoji: reaction.text,
            reactionMessageId: reactionKey?.id || null,
            reactedAt: reactionTimestamp(reaction.senderTimestampMs),
        });

        await deleteReactionPlaceholder({
            deviceId: reactionDeviceId,
            sessionId,
            reactionMessageId: reactionKey?.id,
        }).catch((error) => {
            logger.warn(
                { code: (error as { code?: unknown })?.code },
                'Failed to remove legacy reaction placeholder',
            );
        });

        getSocketIO()
            .to(`session:${sessionId}`)
            .emit(`reaction:${sessionId}`, { ...saved, conversationJid });
        return saved;
    };

    const upsert: BaileysEventHandler<'messages.upsert'> = async ({ messages, type }) => {
        switch (type) {
            case 'append':
            case 'notify':
                for (const message of messages) {
                    try {
                        // Skip only WhatsApp status broadcast channel
                        const remoteJidRaw = message.key?.remoteJid;
                        if (!remoteJidRaw || remoteJidRaw === 'status@broadcast') {
                            continue;
                        }
                        // WhatsApp can identify the same personal chat using a Linked ID
                        // (@lid) while outgoing messages use the phone-number JID. Prefer
                        // the PN alternative so Inbox can merge both directions.
                        const jid = remoteJidRaw.includes('@g.us')
                            ? jidNormalizedUser(remoteJidRaw)
                            : getPhoneJid(remoteJidRaw, message.key.remoteJidAlt) ||
                              jidNormalizedUser(remoteJidRaw);
                        const data = transformPrisma(message);
                        const messageDevicePkId = await getDevicePkId();

                        // Recent WhatsApp versions encrypt group-message edits
                        // with the original messageSecret. This control event
                        // must be decrypted and applied in-place, never stored
                        // as a generic Inbox message.
                        if (
                            messageDevicePkId
                            && await applySecretIncomingMessageEdit({
                                sessionId,
                                deviceId: messageDevicePkId,
                                key: message.key,
                                content: message.message,
                                messageTimestamp: message.messageTimestamp,
                            })
                        ) continue;

                        // Edits are metadata updates for an existing WhatsApp
                        // message. Baileys emits the canonical edit through
                        // messages.update; never let an edit wrapper fall
                        // through and become a new "[Pesan]" Inbox bubble.
                        if (isMessageEditEnvelope(message.message)) {
                            const messageEdit = extractMessageEditEnvelope(
                                message.message,
                                message.key.id,
                                message.messageTimestamp,
                            );
                            if (messageEdit && messageDevicePkId) {
                                await applyIncomingMessageEdit({
                                    sessionId,
                                    deviceId: messageDevicePkId,
                                    messageId: messageEdit.targetMessageId,
                                    text: messageEdit.text,
                                    editedAt: messageEdit.editedAt,
                                    remoteJid: message.key.remoteJid,
                                });
                            } else {
                                logger.warn(
                                    { sessionId, messageId: message.key.id },
                                    'Skipped unsupported message-edit envelope',
                                );
                            }
                            continue;
                        }

                        const messageContent = extractMessageContent(message.message);
                        const reactionMessage = messageContent?.reactionMessage;

                        // A reaction is metadata for another message, not a new
                        // Inbox row. This exact guard does not alter the normal
                        // incoming-message path below.
                        if (reactionMessage?.key?.id) {
                            try {
                                await persistReaction(
                                    reactionMessage.key,
                                    { ...reactionMessage, key: message.key },
                                    jid,
                                );
                            } catch (reactionError) {
                                logger.warn(
                                    {
                                        sessionId,
                                        messageId: message.key.id,
                                        code: (reactionError as { code?: unknown })?.code,
                                    },
                                    'Failed to persist reaction message',
                                );
                            }
                            continue;
                        }
                        const stickerMessage = messageContent?.stickerMessage;

                        const messageText =
                            messageContent?.conversation ||
                            messageContent?.extendedTextMessage?.text ||
                            messageContent?.imageMessage?.caption ||
                            (messageContent?.imageMessage ? '[Gambar]' : '') ||
                            messageContent?.videoMessage?.caption ||
                            (messageContent?.videoMessage ? '[Video]' : '') ||
                            messageContent?.documentMessage?.caption ||
                            messageContent?.documentMessage?.fileName ||
                            (messageContent?.documentMessage ? '[Dokumen]' : '') ||
                            (messageContent?.audioMessage ? '[Audio]' : '') ||
                            (stickerMessage ? '[Stiker]' : '') ||
                            '[Pesan]';

                        if (messageText === '[Pesan]') {
                            logger.warn(
                                safeMessageContext(sessionId, message.key, {
                                    messageStubType: message.messageStubType,
                                    payloadShape: describePayloadShape(message.message),
                                }),
                                'Unsupported incoming WhatsApp payload shape',
                            );
                        }

                        const incomingParticipant = jid.includes('@g.us')
                            ? getPhoneJid(
                                  message.key.participant,
                                  message.key.participantAlt,
                              ) || message.key.participant || null
                            : null;
                        const contactJid = incomingParticipant || jid;
                        const contactPhone = contactJid
                            .split('@')[0]
                            .split(':')[0]
                            .replace(/\D/g, '');
                        const contact = contactPhone
                            ? await prisma.contact.findFirst({
                                  where: {
                                      phone: { in: [contactPhone, `+${contactPhone}`] },
                                      contactDevices: {
                                          some: {
                                              device: {
                                                  sessions: { some: { sessionId } },
                                              },
                                          },
                                      },
                                  },
                              })
                            : null;
                        const quoteMetadata = messageDevicePkId
                            ? await resolveIncomingQuoteMetadata({
                                  deviceId: messageDevicePkId,
                                  conversationJid: jid,
                                  content: messageContent,
                              })
                            : null;
                        const encryptedQuotedText = quoteMetadata?.quotedText
                            ? encryptMessage(quoteMetadata.quotedText)
                            : null;

                        if (data.message && !data.message.protocolMessage) {
                            const dir = path.join('media', `S${sessionId}`);
                            // non-blocking ensure directory exists
                            try {
                                await fs.promises.mkdir(dir, { recursive: true });
                            } catch (mkdirErr) {
                                logger.error({ mkdirErr, dir }, 'Failed to create media directory');
                            }

                            const io: Server = getSocketIO();

                            if (message.key.fromMe) {
                                // 🔒 Log tanpa data sensitif (message content)
                                logger.debug(
                                    safeMessageContext(sessionId, message.key, {
                                        status: data.status,
                                        messageType: redactMessageObject(data.message as any),
                                    }),
                                    'outgoing message event'
                                );

                                let status = 'pending';
                                if (data.status >= 2) status = 'server_ack';
                                if (data.status >= 3) status = 'delivery_ack';
                                if (data.status >= 4) status = 'read';
                                if (data.status >= 5) status = 'played';

                                // Get current status to prevent degradation
                                const currentMessage = await prisma.outgoingMessage.findFirst({
                                    where: {
                                        OR: [
                                            { waMessageId: message.key.id! },
                                            { id: message.key.id! },
                                        ],
                                    },
                                    select: {
                                        pkId: true,
                                        status: true,
                                        waMessageId: true,
                                        deviceId: true,
                                    },
                                });

                                const shouldUpdateStatus = currentMessage
                                    ? canApplyOutgoingMessageStatus(currentMessage.status, status)
                                    : true;

                                const shouldUpdate =
                                    !currentMessage ||
                                    shouldUpdateStatus ||
                                    !currentMessage.deviceId;

                                if (shouldUpdate) {
                                    if (currentMessage?.pkId) {
                                        const statusUpdate = shouldUpdateStatus
                                            ? await prisma.outgoingMessage.updateMany({
                                                  where: {
                                                      pkId: currentMessage.pkId,
                                                      status: {
                                                          in: eligibleOutgoingMessageStatuses(status),
                                                      },
                                                  },
                                                  data: {
                                                      status,
                                                      deviceId: messageDevicePkId,
                                                      waMessageId:
                                                          currentMessage.waMessageId || message.key.id!,
                                                      updatedAt: new Date(),
                                                  },
                                              })
                                            : { count: 0 };

                                        const shouldUpdateMetadata = !currentMessage.deviceId;
                                        if (statusUpdate.count === 0 && shouldUpdateMetadata) {
                                            await prisma.outgoingMessage.update({
                                                where: { pkId: currentMessage.pkId },
                                                data: {
                                                    deviceId: messageDevicePkId,
                                                    waMessageId:
                                                        currentMessage.waMessageId || message.key.id!,
                                                    updatedAt: new Date(),
                                                },
                                            });
                                        }

                                        if (statusUpdate.count > 0 || shouldUpdateMetadata) {
                                            const outgoingMessage =
                                                await prisma.outgoingMessage.findUnique({
                                                    where: { pkId: currentMessage.pkId },
                                                    include: {
                                                        contact: { include: inboxContactLabelInclude },
                                                    },
                                                });
                                            if (outgoingMessage) {
                                                io.to(`session:${sessionId}`).emit(
                                                    `message:${sessionId}`,
                                                    outgoingMessage,
                                                );
                                                io.to(`session:${sessionId}`).emit(
                                                    `outgoing:${sessionId}`,
                                                    decryptOutgoingMessage(outgoingMessage),
                                                );
                                            }
                                        }
                                    } else {
                                        // ⚠️ CRITICAL FIX: Check existing message before upsert to prevent downgrade
                                        const existingMessage = await prisma.outgoingMessage.findFirst({
                                            where: { id: message.key.id! },
                                            select: { pkId: true, status: true },
                                        });
                                        
                                        // If message exists, check status hierarchy before update
                                        if (existingMessage) {
                                            // Only update if new status is higher
                                            if (canApplyOutgoingMessageStatus(existingMessage.status, status)) {
                                                const statusUpdate = await prisma.outgoingMessage.updateMany({
                                                    where: {
                                                        pkId: existingMessage.pkId,
                                                        status: {
                                                            in: eligibleOutgoingMessageStatuses(status),
                                                        },
                                                    },
                                                    data: {
                                                        status,
                                                        deviceId: messageDevicePkId,
                                                        waMessageId: message.key.id!,
                                                        updatedAt: new Date(),
                                                    },
                                                });
                                                
                                                const updatedMessage = statusUpdate.count > 0
                                                    ? await prisma.outgoingMessage.findUnique({
                                                          where: { pkId: existingMessage.pkId },
                                                          include: {
                                                              contact: {
                                                                  include: inboxContactLabelInclude,
                                                              },
                                                          },
                                                      })
                                                    : null;
                                                
                                                if (updatedMessage) {
                                                    io.to(`session:${sessionId}`).emit(`message:${sessionId}`, updatedMessage);
                                                    io.to(`session:${sessionId}`).emit(
                                                        `outgoing:${sessionId}`,
                                                        decryptOutgoingMessage(updatedMessage),
                                                    );
                                                }
                                            }
                                        } else {
                                            // Message doesn't exist, safe to create
                                            const outgoingMessage = await prisma.outgoingMessage.create({
                                                data: {
                                                    id: message.key.id!,
                                                    waMessageId: message.key.id!,
                                                    to: jid,
                                                    message: encryptMessage(messageText),
                                                    schedule: new Date(),
                                                    status,
                                                    sessionId,
                                                    deviceId: messageDevicePkId,
                                                    contactId: contact?.pkId || null,
                                                    quotedMessageId:
                                                        quoteMetadata?.quotedMessageId || null,
                                                    quotedFromMe:
                                                        quoteMetadata?.quotedFromMe ?? null,
                                                    quotedText: encryptedQuotedText,
                                                    quotedSender:
                                                        quoteMetadata?.quotedSender || null,
                                                },
                                                include: {
                                                    contact: { include: inboxContactLabelInclude },
                                                },
                                            });
                                            io.to(`session:${sessionId}`).emit(`message:${sessionId}`, outgoingMessage);
                                            io.to(`session:${sessionId}`).emit(
                                                `outgoing:${sessionId}`,
                                                decryptOutgoingMessage(outgoingMessage),
                                            );
                                        }
                                    }
                                } else {
                                    logger.debug(
                                        {
                                            messageId: message.key.id,
                                            currentStatus: currentMessage?.status,
                                            newStatus: status,
                                        },
                                        'Skipping status update - would downgrade status',
                                    );
                                }
                            } else {
                                // 🔒 Log tanpa data sensitif (message content)
                                logger.debug(
                                    safeMessageContext(sessionId, message.key, {
                                        messageType: redactMessageObject(data.message as any),
                                    }),
                                    'incoming message event'
                                );
                                if (!jid.includes('@g.us')) {
                                    // Run both replies but don't block the main flow; catch rejections
                                    Promise.allSettled([
                                        sendOutsideBusinessHourMessage(sessionId, message),
                                        sendCampaignReply(sessionId, message),
                                    ]).then((results) => {
                                        results.forEach((r, idx) => {
                                            if (r.status === 'rejected') {
                                                logger.error(
                                                    {
                                                        idx,
                                                        reason: (r as PromiseRejectedResult).reason,
                                                    },
                                                    'Aux handler failed',
                                                );
                                            }
                                        });
                                    });
                                } else {
                                    // For group messages, still trigger campaign reply (if desired)
                                    Promise.allSettled([
                                        sendCampaignReply(sessionId, message),
                                    ]).catch(() => {});
                                }
                                
                                // 🆕 Simpan pesan masuk ke database
                                try {
                                    // Get pushName (WhatsApp profile name) from message
                                    const pushName = message.pushName || null;
                                    
                                    // Get participant (sender in group) from message key
                                    const participant = incomingParticipant;
                                    
                                    // Get group name and picture if it's a group message
                                    let groupName: string | null = null;
                                    let groupPicUrl: string | null = null;
                                    let incomingMediaPath: string | null = null;
                                    const incomingFileName = messageContent?.documentMessage?.fileName
                                        ? path.basename(messageContent.documentMessage.fileName)
                                        : null;
                                    
                                    const session = getInstance(sessionId);

                                    // Download incoming media so Inbox can render it after refresh.
                                    // Keep the text placeholder as a preview/fallback.
                                    const incomingMedia = stickerMessage
                                        ? { content: stickerMessage, kind: 'sticker' }
                                        : messageContent?.imageMessage
                                          ? { content: messageContent.imageMessage, kind: 'image' }
                                          : messageContent?.videoMessage
                                            ? { content: messageContent.videoMessage, kind: 'video' }
                                            : messageContent?.audioMessage
                                              ? { content: messageContent.audioMessage, kind: 'audio' }
                                              : messageContent?.documentMessage
                                                ? {
                                                      content: messageContent.documentMessage,
                                                      kind: 'document',
                                                  }
                                                : null;

                                    const downloadAndPersistIncomingMedia = async (
                                        maxAttempts: number,
                                    ): Promise<string | null> => {
                                        if (!incomingMedia) return null;

                                        let mediaBuffer: Buffer | null = null;
                                        let lastError: unknown = null;
                                        for (let attempt = 1; attempt <= maxAttempts; attempt++) {
                                            try {
                                                mediaBuffer = await downloadMediaMessage(
                                                    message,
                                                    'buffer',
                                                    {},
                                                    session?.updateMediaMessage
                                                        ? {
                                                              reuploadRequest:
                                                                  session.updateMediaMessage.bind(session),
                                                              logger,
                                                          }
                                                        : undefined,
                                                );
                                                if (mediaBuffer && mediaBuffer.length > 0) break;
                                                throw new Error('Downloaded media is empty');
                                            } catch (error) {
                                                lastError = error;
                                                try {
                                                    // Some sticker variants are not recovered correctly by
                                                    // downloadMediaMessage even though their direct media
                                                    // descriptor is still valid.
                                                    const stream = await downloadContentFromMessage(
                                                        incomingMedia.content,
                                                        incomingMedia.kind as any,
                                                    );
                                                    const chunks: Array<
                                                        ReturnType<typeof copyToNativeUint8Array>
                                                    > = [];
                                                    let totalLength = 0;
                                                    for await (const chunk of stream) {
                                                        const bytes = copyToNativeUint8Array(chunk);
                                                        chunks.push(bytes);
                                                        totalLength += bytes.length;
                                                    }
                                                    const combined = new Uint8Array(totalLength);
                                                    let offset = 0;
                                                    for (const bytes of chunks) {
                                                        combined.set(bytes, offset);
                                                        offset += bytes.length;
                                                    }
                                                    mediaBuffer = Buffer.from(combined);
                                                    if (mediaBuffer.length > 0) break;
                                                } catch (directDownloadError) {
                                                    lastError = directDownloadError;
                                                }
                                                try {
                                                    mediaBuffer = await downloadWhatsAppMediaOverIpv4(
                                                        incomingMedia.content,
                                                        incomingMedia.kind,
                                                    );
                                                    if (mediaBuffer.length > 0) {
                                                        logger.info(
                                                            {
                                                                sessionId,
                                                                messageId: message.key.id,
                                                                mediaKind: incomingMedia.kind,
                                                            },
                                                            'Incoming media downloaded through IPv4 fallback',
                                                        );
                                                        break;
                                                    }
                                                } catch (ipv4DownloadError) {
                                                    lastError = ipv4DownloadError;
                                                }
                                                if (attempt < maxAttempts) {
                                                    await new Promise((resolve) =>
                                                        setTimeout(resolve, attempt * 750),
                                                    );
                                                }
                                            }
                                        }

                                        if (!mediaBuffer || mediaBuffer.length === 0) {
                                            throw lastError || new Error('Failed to download media');
                                        }

                                        const safeMessageId = message.key.id!.replace(
                                            /[^a-zA-Z0-9_-]/g,
                                            '_',
                                        );
                                        const mimeType = incomingMedia.content.mimetype || '';
                                        const mimeExtensions: Record<string, string> = {
                                            'image/jpeg': 'jpg',
                                            'image/png': 'png',
                                            'image/gif': 'gif',
                                            'image/webp': 'webp',
                                            'video/mp4': 'mp4',
                                            'video/quicktime': 'mov',
                                            'video/webm': 'webm',
                                            'audio/mpeg': 'mp3',
                                            'audio/ogg': 'ogg',
                                            'audio/wav': 'wav',
                                            'audio/webm': 'webm',
                                            'application/pdf': 'pdf',
                                        };
                                        const originalName =
                                            'fileName' in incomingMedia.content
                                                ? incomingMedia.content.fileName || ''
                                                : '';
                                        const safeOriginalName = path
                                            .basename(originalName)
                                            .replace(/[^a-zA-Z0-9._-]/g, '_');
                                        const originalExtension = path
                                            .extname(safeOriginalName)
                                            .replace('.', '');
                                        const extension =
                                            (incomingMedia.kind === 'sticker' && 'webp') ||
                                            originalExtension ||
                                            mimeExtensions[mimeType] ||
                                            'bin';

                                        if (incomingMedia.kind === 'sticker') {
                                            const thumbnail = stickerMessage?.pngThumbnail;
                                            // Lottie stickers are not directly renderable by an <img>.
                                            // Use the PNG preview while preserving regular/animated WebP.
                                            if (stickerMessage?.isLottie && thumbnail?.length) {
                                                return `data:image/png;base64,${Buffer.from(thumbnail).toString('base64')}`;
                                            }

                                            try {
                                                const metadata = await sharp(mediaBuffer).metadata();
                                                const detectedMimeType = metadata.format
                                                    ? `image/${metadata.format}`
                                                    : mimeType || 'image/webp';
                                                return `data:${detectedMimeType};base64,${mediaBuffer.toString('base64')}`;
                                            } catch (invalidStickerError) {
                                                if (thumbnail?.length) {
                                                    logger.warn(
                                                        {
                                                            invalidStickerError,
                                                            sessionId,
                                                            messageId: message.key.id,
                                                        },
                                                        'Sticker payload is not browser-renderable; using thumbnail',
                                                    );
                                                    return `data:image/png;base64,${Buffer.from(thumbnail).toString('base64')}`;
                                                }
                                                throw invalidStickerError;
                                            }
                                        }

                                        const mediaFileName = safeOriginalName
                                            ? `${safeMessageId}-${safeOriginalName}`
                                            : `${safeMessageId}.${extension}`;
                                        const mediaFilePath = path.join(dir, mediaFileName);
                                        await fs.promises.writeFile(
                                            mediaFilePath,
                                            copyToNativeUint8Array(mediaBuffer),
                                        );
                                        return mediaFilePath.replace(/\\/g, '/');
                                    };

                                    if (incomingMedia) {
                                        try {
                                            incomingMediaPath =
                                                await downloadAndPersistIncomingMedia(3);
                                        } catch (mediaError) {
                                            if (
                                                incomingMedia.kind === 'sticker' &&
                                                stickerMessage?.pngThumbnail?.length
                                            ) {
                                                incomingMediaPath = `data:image/png;base64,${Buffer.from(
                                                    stickerMessage.pngThumbnail,
                                                ).toString('base64')}`;
                                            }
                                            logger.warn(
                                                {
                                                    mediaError,
                                                    sessionId,
                                                    messageId: message.key.id,
                                                    mediaKind: incomingMedia.kind,
                                                },
                                                'Initial incoming media download failed; scheduling recovery',
                                            );
                                        }
                                    }
                                    
                                    if (jid.includes('@g.us')) {
                                        // GROUP MESSAGE - Get group metadata (name only, picture in background)
                                        try {
                                            if (session && typeof session.groupMetadata === 'function') {
                                                const groupMeta = await session.groupMetadata(jid);
                                                groupName = groupMeta?.subject || null;
                                            }
                                        } catch (groupErr) {
                                            logger.debug({ groupErr, jid }, 'Failed to fetch group metadata');
                                        }
                                    }
                                    
                                    // ✅ PERFORMANCE FIX: Simpan pesan DULU tanpa profile picture (instant)
                                    // Profile picture akan di-fetch di background dan di-update kemudian
                                    const encryptedIncomingText = encryptMessage(messageText);
                                    const existingIncomingMessage = await prisma.incomingMessage.findUnique({
                                        where: { id: message.key.id! },
                                        select: { id: true },
                                    });
                                    const incomingMessage = await prisma.incomingMessage.upsert({
                                        where: { id: message.key.id! },
                                        create: {
                                            id: message.key.id!,
                                            from: jid,
                                            participant,
                                            pushName,
                                            groupName,
                                            groupPicUrl: null, // Will be fetched in background
                                            profilePicUrl: null, // Will be fetched in background
                                            message: encryptedIncomingText,
                                            mediaPath: incomingMediaPath,
                                            fileName: incomingFileName,
                                            receivedAt: new Date(Number(data.messageTimestamp) * 1000),
                                            sessionId,
                                            deviceId: deviceId || null,
                                            contactId: contact?.pkId || null,
                                            quotedMessageId:
                                                quoteMetadata?.quotedMessageId || null,
                                            quotedFromMe:
                                                quoteMetadata?.quotedFromMe ?? null,
                                            quotedText: encryptedQuotedText,
                                            quotedSender: quoteMetadata?.quotedSender || null,
                                        },
                                        update: {
                                            // Update metadata if changed
                                            participant,
                                            groupName,
                                            pushName,
                                            message: encryptedIncomingText,
                                            ...(contact?.pkId ? { contactId: contact.pkId } : {}),
                                            ...(incomingMediaPath ? { mediaPath: incomingMediaPath } : {}),
                                            ...(incomingFileName ? { fileName: incomingFileName } : {}),
                                            ...(quoteMetadata
                                                ? {
                                                      quotedMessageId:
                                                          quoteMetadata.quotedMessageId,
                                                      quotedFromMe:
                                                          quoteMetadata.quotedFromMe,
                                                      quotedText: encryptedQuotedText,
                                                      quotedSender:
                                                          quoteMetadata.quotedSender,
                                                  }
                                                : {}),
                                        },
                                        include: {
                                            contact: { include: inboxContactLabelInclude },
                                        },
                                    });

                                    if (messageDevicePkId) {
                                        await saveIncomingMessageSecret({
                                            messageId: incomingMessage.id,
                                            deviceId: messageDevicePkId,
                                            sessionId,
                                            key: message.key,
                                            content: messageContent,
                                        });
                                    }

                                    // WhatsApp CDN access can be intermittent in production. If the
                                    // initial attempts fail, recover the media without delaying the
                                    // incoming-message notification.
                                    if (incomingMedia && !incomingMediaPath) {
                                        void (async () => {
                                            await new Promise((resolve) => setTimeout(resolve, 5_000));
                                            try {
                                                const recoveredMediaPath =
                                                    await downloadAndPersistIncomingMedia(3);
                                                if (!recoveredMediaPath) return;

                                                const recoveredMessage =
                                                    await prisma.incomingMessage.update({
                                                        where: { id: message.key.id! },
                                                        data: { mediaPath: recoveredMediaPath },
                                                        include: {
                                                            contact: {
                                                                include: inboxContactLabelInclude,
                                                            },
                                                        },
                                                    });
                                                const recoveredDeviceUuid = await getDeviceUuid();
                                                io.to(`session:${sessionId}`).emit(`incoming:${sessionId}:media-updated`, {
                                                    ...recoveredMessage,
                                                    mediaType: resolveInboxMediaType(
                                                        recoveredMessage.mediaPath,
                                                        recoveredMessage.fileName,
                                                        messageText,
                                                    ),
                                                    mediaPath: recoveredDeviceUuid
                                                        ? serializeInboxMediaPath(
                                                              recoveredMessage.mediaPath,
                                                              recoveredDeviceUuid,
                                                              recoveredMessage.id,
                                                          )
                                                        : recoveredMessage.mediaPath,
                                                    isGroup: jid.includes('@g.us'),
                                                });
                                                logger.info(
                                                    {
                                                        sessionId,
                                                        messageId: message.key.id,
                                                        mediaKind: incomingMedia.kind,
                                                    },
                                                    'Incoming media recovered in background',
                                                );
                                            } catch (mediaError) {
                                                logger.error(
                                                    {
                                                        mediaError,
                                                        sessionId,
                                                        messageId: message.key.id,
                                                        mediaKind: incomingMedia.kind,
                                                    },
                                                    'Incoming media recovery failed',
                                                );
                                            }
                                        })();
                                    }

                                    // Fetch and persist the binary outside the HTTP request path.
                                    // The browser never receives WhatsApp's short-lived CDN URL.
                                    if (
                                        deviceId &&
                                        !jid.endsWith('@lid') &&
                                        session &&
                                        typeof session.profilePictureUrl === 'function'
                                    ) {
                                        void refreshInboxProfileCache({ deviceId, jid, session })
                                            .then(async (result) => {
                                                if (!result.hasImage) return;

                                                const [updatedMessage, publicDeviceUuid] = await Promise.all([
                                                    prisma.incomingMessage.findUnique({
                                                        where: { id: message.key.id! },
                                                        include: {
                                                            contact: {
                                                                include: inboxContactLabelInclude,
                                                            },
                                                        },
                                                    }),
                                                    getDeviceUuid(),
                                                ]);
                                                if (!updatedMessage || !publicDeviceUuid) return;

                                                const profileUrl = createInboxProfileUrl(publicDeviceUuid, jid);
                                                io.to(`session:${sessionId}`)
                                                    .to(`device:${publicDeviceUuid}`)
                                                    .emit(
                                                        `incoming:${sessionId}:profile-updated`,
                                                        {
                                                            ...decryptIncomingMessage(updatedMessage),
                                                            profilePicUrl: jid.includes('@g.us') ? null : profileUrl,
                                                            groupPicUrl: jid.includes('@g.us') ? profileUrl : null,
                                                            profilePictureStatus: result.status,
                                                            isGroup: jid.includes('@g.us'),
                                                        },
                                                    );
                                            })
                                            .catch((picError) => {
                                                logger.debug(
                                                    { code: picError?.code, messageId: message.key.id },
                                                    '[InboxProfile] Background refresh failed',
                                                );
                                            });
                                    }

                                    // Group bubbles use the sender's picture, not the
                                    // group's picture. Cache it independently by the
                                    // participant PN JID and notify an already-open Inbox.
                                    if (
                                        deviceId &&
                                        jid.includes('@g.us') &&
                                        participant &&
                                        !participant.endsWith('@lid') &&
                                        session &&
                                        typeof session.profilePictureUrl === 'function'
                                    ) {
                                        void refreshInboxProfileCache({
                                            deviceId,
                                            jid: participant,
                                            session,
                                        })
                                            .then(async (result) => {
                                                if (!result.hasImage) return;
                                                const publicDeviceUuid = await getDeviceUuid();
                                                if (!publicDeviceUuid) return;

                                                io.to(`session:${sessionId}`)
                                                    .to(`device:${publicDeviceUuid}`)
                                                    .emit(
                                                        `incoming:${sessionId}:profile-updated`,
                                                        {
                                                            id: incomingMessage.id,
                                                            from: jid,
                                                            participant,
                                                            senderProfilePicUrl:
                                                                createInboxProfileUrl(
                                                                    publicDeviceUuid,
                                                                    participant,
                                                                ),
                                                            senderProfileStatus: result.status,
                                                        },
                                                    );
                                            })
                                            .catch((picError) => {
                                                logger.debug(
                                                    {
                                                        code: picError?.code,
                                                        messageId: message.key.id,
                                                    },
                                                    '[InboxProfile] Group sender refresh failed',
                                                );
                                            });
                                    }

                                    // Emit socket event untuk real-time update
                                    const emitEventName = `incoming:${sessionId}`;
                                    const publicDeviceUuid = await getDeviceUuid();
                                    const emitPayload = {
                                        ...decryptIncomingMessage(incomingMessage),
                                        mediaType: resolveInboxMediaType(
                                            incomingMessage.mediaPath,
                                            incomingMessage.fileName,
                                            messageText,
                                        ),
                                        mediaPath: publicDeviceUuid
                                            ? serializeInboxMediaPath(
                                                  incomingMessage.mediaPath,
                                                  publicDeviceUuid,
                                                  incomingMessage.id,
                                              )
                                            : incomingMessage.mediaPath,
                                        profilePicUrl: null,
                                        groupPicUrl: null,
                                        profilePictureStatus: 'pending',
                                        senderProfilePicUrl:
                                            publicDeviceUuid
                                            && participant
                                            && !participant.endsWith('@lid')
                                                ? createInboxProfileUrl(
                                                      publicDeviceUuid,
                                                      participant,
                                                  )
                                                : null,
                                        senderProfileStatus:
                                            participant && !participant.endsWith('@lid')
                                                ? 'pending'
                                                : 'unavailable',
                                        isGroup: jid.includes('@g.us'),
                                    };
                                    
                                    if (
                                        !existingIncomingMessage &&
                                        shouldEmitIncomingSocketEvent(sessionId, incomingMessage.id)
                                    ) {
                                        io.to(`session:${sessionId}`).emit(emitEventName, emitPayload);

                                        logger.info(
                                            {
                                                sessionId,
                                                from: redactPhone(jid),
                                                participant: redactPhone(participant || ''),
                                                pushName,
                                                groupName,
                                                messageId: message.key.id,
                                                socketEventEmitted: emitEventName,
                                                connectedClients: io.sockets.sockets.size,
                                            },
                                            'Incoming message saved and socket event emitted',
                                        );
                                    } else {
                                        logger.debug(
                                            {
                                                sessionId,
                                                messageId: incomingMessage.id,
                                                alreadyPersisted: Boolean(existingIncomingMessage),
                                            },
                                            'Skipped duplicate incoming socket event',
                                        );
                                    }
                                } catch (saveError: any) {
                                    // Handle duplicate key error (message already exists)
                                    if (saveError?.code === 'P2002') {
                                        logger.debug(
                                            { sessionId, messageId: message.key.id },
                                            'Incoming message already exists, skipping'
                                        );
                                    } else {
                                        logger.error(
                                            { error: saveError, sessionId, messageId: message.key.id },
                                            'Failed to save incoming message'
                                        );
                                    }
                                }
                            }
                        }
                    } catch (e) {
                        logger.error(e, 'An error occurred during message upsert');
                    }
                }
                break;
        }
    };

    // Retained for reference while ACK/NACK processing is consolidated in the
    // generation-aware socket listener. It is intentionally not registered.
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const update: BaileysEventHandler<'messages.update'> = async (updates) => {
        for (const { update, key } of updates) {
            try {
                if (key.remoteJid !== 'status@broadcast') {
                    await prisma.$transaction(async (tx) => {
                        // 🔧 FIX: Tambah select untuk readBy dan isGroup
                        const selectFields = {
                            pkId: true,
                            status: true,
                            waMessageId: true,
                            isGroup: true,
                            readBy: true,
                            to: true, // ✅ Include 'to' for debugging
                        };

                        // ✅ CRITICAL FIX: Determine the correct 'to' field for query
                        // For group messages: key.remoteJid is the GROUP JID (ends with @g.us)
                        // For personal messages: key.remoteJid is the RECIPIENT JID
                        // ✅ Query dengan filter 'to' yang tepat
                        const outgoingByWaId = await tx.outgoingMessage.findFirst({
                            where: { 
                                waMessageId: key.id!, 
                                sessionId 
                            },
                            select: selectFields,
                        });

                        // Legacy fallbacks (older rows) - also add 'to' filter
                        const prevOutMessages = outgoingByWaId
                            ? null
                            : await tx.outgoingMessage.findFirst({
                                  where: { 
                                      id: key.id!, 
                                      sessionId 
                                  },
                                  select: selectFields,
                              });

                        const prevOutMessagesByComposite =
                            !outgoingByWaId && !prevOutMessages
                                ? await tx.outgoingMessage.findFirst({
                                      where: { id: key.id!, to: key.remoteJid!, sessionId },
                                      select: selectFields,
                                  })
                                : null;

                        const outgoingMessage = outgoingByWaId || prevOutMessages || prevOutMessagesByComposite;

                        // Try to find the message in the Message table
                        const prevMessages = await tx.message.findFirst({
                            where: { id: key.id!, remoteJid: key.remoteJid!, sessionId },
                        });

                        // Update Message table if it exists
                        if (prevMessages) {
                            const data = { ...prevMessages, ...update } as proto.IWebMessageInfo;
                            await tx.message.update({
                                where: {
                                    sessionId_remoteJid_id: {
                                        id: key.id!,
                                        remoteJid: key.remoteJid!,
                                        sessionId,
                                    },
                                },
                                data: transformPrisma(data),
                            });
                        }

                        // Update status mapping
                        let status = 'pending';
                        
                        // ✅ DEBUG: Log raw status update untuk debugging
                        logger.info(
                            {
                                sessionId,
                                messageId: key.id,
                                remoteJid: key.remoteJid,
                                fromMe: key.fromMe,
                                rawStatus: update.status,
                                statusType: typeof update.status
                            },
                            '🔍 Raw status update received from WhatsApp'
                        );
                        
                        switch (update.status) {
                            case 0:
                                status = 'error';
                                break;
                            case 1:
                                status = 'pending';
                                break;
                            case 2:
                                status = 'server_ack';
                                break;
                            case 3:
                                status = 'delivery_ack';
                                break;
                            case 4:
                                status = 'read';
                                break;
                            case 5:
                                status = 'played';
                                break;
                        }

                        // Update OutgoingMessage status if the message exists and it's from us
                        if (outgoingMessage && key.fromMe) {
                            logger.info(
                                {
                                    sessionId,
                                    messageId: key.id,
                                    remoteJid: key.remoteJid,
                                    outgoingMessageTo: outgoingMessage.to,
                                    recipientMatch: outgoingMessage.to === key.remoteJid,
                                    fromMe: key.fromMe,
                                    currentStatus: outgoingMessage.status,
                                    newStatus: status,
                                    waMessageId: outgoingMessage.waMessageId
                                },
                                '📤 Processing status update for OUTGOING message'
                            );
                            
                            const currentLevel = outgoingMessageStatusLevel(
                                outgoingMessage.status,
                            );
                            const newLevel = outgoingMessageStatusLevel(status);
                            const shouldApplyStatus = canApplyOutgoingMessageStatus(
                                outgoingMessage.status,
                                status,
                            );

                            logger.info(
                                {
                                    sessionId,
                                    messageId: key.id,
                                    currentStatus: outgoingMessage.status,
                                    currentLevel,
                                    newStatus: status,
                                    newLevel,
                                    willUpdate: shouldApplyStatus,
                                },
                                '🔍 Status hierarchy check'
                            );

                            if (shouldApplyStatus) {
                                logger.info(
                                    {
                                        sessionId,
                                        messageId: key.id,
                                        newStatus: status,
                                        oldStatus: outgoingMessage.status,
                                        statusUpgrade: `${currentLevel} → ${newLevel}`
                                    },
                                    'Updating outgoing message status to higher level',
                                );

                                // 🔧 FIX: Track readers untuk grup DAN personal
                                const updateData: any = { 
                                    status, 
                                    waMessageId: outgoingMessage.waMessageId || key.id!, 
                                    updatedAt: new Date() 
                                };

                                // ✅ GRUP: Track semua member yang membaca (readBy array)
                                // ✅ PERSONAL: Hanya ubah status jadi 'read'
                                if (status === 'read') {
                                    if (outgoingMessage.isGroup) {
                                        // Untuk grup: tambahkan participant ke readBy array
                                        const participant = key.participant || key.remoteJid;
                                        if (participant) {
                                            const prev = Array.isArray(outgoingMessage.readBy) 
                                                ? (outgoingMessage.readBy as string[]) 
                                                : [];
                                            const readerSet = new Set<string>(prev);
                                            readerSet.add(participant);
                                            updateData.readBy = Array.from(readerSet);
                                            
                                            logger.info(
                                                {
                                                    messageId: key.id,
                                                    participant,
                                                    totalReaders: updateData.readBy.length
                                                },
                                                '📖 Group message read by member'
                                            );
                                        }
                                    } else {
                                        // Untuk personal: simpan remoteJid ke readBy
                                        if (key.remoteJid) {
                                            const prev = Array.isArray(outgoingMessage.readBy) 
                                                ? (outgoingMessage.readBy as string[]) 
                                                : [];
                                            const readerSet = new Set<string>(prev);
                                            readerSet.add(key.remoteJid);
                                            updateData.readBy = Array.from(readerSet);
                                        }
                                    }
                                }

                                // Always update by pkId to avoid ambiguity
                                const statusUpdate = await tx.outgoingMessage.updateMany({
                                    where: {
                                        pkId: outgoingMessage.pkId,
                                        status: {
                                            in: eligibleOutgoingMessageStatuses(status),
                                        },
                                    },
                                    data: updateData,
                                });

                                if (statusUpdate.count === 0) {
                                    logger.debug(
                                        {
                                            sessionId,
                                            messageId: key.id,
                                            attemptedStatus: status,
                                        },
                                        'Skipping raced status update because current status is terminal or newer',
                                    );
                                    return;
                                }

                                const updatedMessage = await tx.outgoingMessage.findUnique({
                                    where: { pkId: outgoingMessage.pkId },
                                });
                                if (!updatedMessage) return;
                                
                                // ✅ EMIT socket event for real-time status update (ONLY on upgrade)
                                const statusDeviceUuid = await getDeviceUuid();
                                if (statusDeviceUuid) {
                                    const io = getSocketIO();
                                    const eventPayload: any = {
                                        waMessageId: updatedMessage.waMessageId || key.id!,
                                        status: updatedMessage.status,
                                        timestamp: new Date().toISOString(),
                                    };

                                    if (status === 'error') {
                                        const failureCode = String(
                                            update.messageStubParameters?.[0] || '',
                                        ).trim();
                                        eventPayload.errorCode = failureCode || null;
                                        logger.warn(
                                            {
                                                sessionId,
                                                messageId: key.id,
                                                failureCode: failureCode || 'unknown',
                                                addressing: key.remoteJid?.includes('@lid')
                                                    ? 'lid'
                                                    : 'pn',
                                            },
                                            '[DeliveryReceipt] WhatsApp rejected outgoing message',
                                        );
                                    }
                                    
                                    // ✅ For group messages: include readBy count
                                    if (outgoingMessage.isGroup && Array.isArray(updateData.readBy)) {
                                        eventPayload.readCount = updateData.readBy.length;
                                        eventPayload.readBy = updateData.readBy;
                                    }
                                    
                                    io.to(`session:${sessionId}`).emit(
                                        `device:${statusDeviceUuid}:message-status`,
                                        eventPayload,
                                    );
                                    
                                    logger.info(
                                        {
                                            sessionId,
                                            deviceId,
                                            deviceUuid: statusDeviceUuid,
                                            waMessageId: updatedMessage.waMessageId,
                                            status: updatedMessage.status,
                                            readCount: eventPayload.readCount,
                                            isGroup: outgoingMessage.isGroup,
                                            eventEmitted: `device:${statusDeviceUuid}:message-status`
                                        },
                                        '📤 Status update emitted to frontend (UPGRADE)'
                                    );
                                } else {
                                    logger.warn(
                                        {
                                            sessionId,
                                            waMessageId: updatedMessage.waMessageId,
                                            status: updatedMessage.status
                                        },
                                        'Cannot emit status update - public device UUID is unavailable'
                                    );
                                }
                            } else {
                                logger.debug(
                                    {
                                        sessionId,
                                        messageId: key.id,
                                        currentStatus: outgoingMessage.status,
                                        newStatus: status,
                                        currentLevel,
                                        newLevel,
                                    },
                                    'Skipping status update - would downgrade or maintain same status',
                                );
                            }
                        } else if (key.fromMe && !outgoingMessage) {
                            // Log when we receive status update but message not found
                            logger.warn(
                                {
                                    messageId: key.id,
                                    remoteJid: key.remoteJid,
                                    sessionId,
                                    status,
                                    fromMe: key.fromMe
                                },
                                'Received status update for unknown outgoing message'
                            );
                        } else if (!key.fromMe && outgoingMessage) {
                            // ⚠️ SUSPICIOUS: Incoming message matched with outgoing message!
                            logger.warn(
                                {
                                    messageId: key.id,
                                    remoteJid: key.remoteJid,
                                    sessionId,
                                    status,
                                    fromMe: key.fromMe,
                                    outgoingWaMessageId: outgoingMessage.waMessageId,
                                    outgoingStatus: outgoingMessage.status
                                },
                                '⚠️ SUSPICIOUS: Incoming message (fromMe=false) matched with outgoing message entry - this should not happen!'
                            );
                        }
                    });
                }
            } catch (e) {
                logger.error(
                    { error: e, messageId: key.id, sessionId },
                    'An error occurred during message update',
                );
            }
        }
    };

    const del: BaileysEventHandler<'messages.delete'> = async (item) => {
        try {
            if ('all' in item) {
                await prisma.message.deleteMany({ where: { remoteJid: item.jid, sessionId } });
                return;
            }

            const jid = item.keys[0].remoteJid!;
            await prisma.message.deleteMany({
                where: {
                    id: { in: item.keys.map((k: { id: any }) => k.id!) },
                    remoteJid: jid,
                    sessionId,
                },
            });
        } catch (e) {
            logger.error(e, 'An error occured during message delete');
        }
    };

    const updateReceipt: BaileysEventHandler<'message-receipt.update'> = async (updates) => {
        for (const { key, receipt } of updates) {
            try {
                await prisma.$transaction(async (tx) => {
                    // Try to update Message.userReceipt if Message row exists (optional)
                    const message = await tx.message.findFirst({
                        select: { userReceipt: true },
                        where: { id: key.id!, remoteJid: key.remoteJid!, sessionId },
                    });

                    if (message) {
                        let userReceipt = (message.userReceipt || []) as unknown as MessageUserReceipt[];
                        const recepient = userReceipt.find((m) => m.userJid === receipt.userJid);

                        if (recepient) {
                            userReceipt = [
                                ...userReceipt.filter((m) => m.userJid !== receipt.userJid),
                                receipt,
                            ];
                        } else {
                            userReceipt.push(receipt);
                        }

                        await tx.message.update({
                            select: { pkId: true },
                            data: transformPrisma({ userReceipt: userReceipt }),
                            where: {
                                sessionId_remoteJid_id: {
                                    id: key.id!,
                                    remoteJid: key.remoteJid!,
                                    sessionId,
                                },
                            },
                        });
                    }

                    // === Track read receipts for outgoing messages (both group & individual) ===
                    if (!key.fromMe) return;
                    if (!key.id) return;

                    const outgoing = await tx.outgoingMessage.findFirst({
                        where: {
                            OR: [
                                { waMessageId: key.id, sessionId },
                                { id: key.id, sessionId },
                                { id: key.id, to: key.remoteJid || undefined, sessionId },
                            ],
                        },
                        select: {
                            pkId: true,
                            id: true,
                            status: true,
                            isGroup: true,
                            readBy: true,
                            waMessageId: true,
                            to: true,
                        },
                    });

                    if (!outgoing) return;

                    const receiptType = String(
                        (receipt as any)?.receipt || (receipt as any)?.type || '',
                    ).toLowerCase();

                    const hasRead =
                        !!(receipt as any)?.readTimestamp ||
                        receiptType.includes('read') ||
                        receiptType === 'read';

                    const hasDeliver =
                        !!(receipt as any)?.deliveryTimestamp ||
                        receiptType.includes('delivery') ||
                        receiptType.includes('delivered') ||
                        receiptType === 'delivery';

                    const prev = Array.isArray(outgoing.readBy) ? (outgoing.readBy as any[]) : [];
                    const set = new Set<string>(prev.map((x) => String(x)));

                    // 🔧 FIX: Track reader untuk SEMUA pesan (group & individual)
                    const readerJid = (receipt as any)?.userJid;
                    if (hasRead) {
                        if (readerJid) {
                            set.add(String(readerJid));
                        } else if (!outgoing.isGroup && outgoing.to) {
                            // Untuk pesan individual tanpa userJid, gunakan recipient (to)
                            set.add(String(outgoing.to));
                        }
                    }

                    const nextStatus = resolveParticipantReceiptStatus(outgoing.status, {
                        isGroup: Boolean(outgoing.isGroup),
                        hasRead,
                        hasDeliver,
                    });

                    if (hasRead || hasDeliver) {
                        logger.debug(
                            {
                                sessionId,
                                messageId: key.id,
                                receipt: hasRead ? 'read' : 'delivered',
                                addressing: String((receipt as any)?.userJid || '').includes('@lid')
                                    ? 'lid'
                                    : 'pn',
                            },
                            '[DeliveryReceipt] Outgoing message receipt received',
                        );
                    }

                    const updateData: any = {
                        waMessageId: outgoing.waMessageId || key.id,
                        updatedAt: new Date(),
                    };

                    if (hasRead && set.size) updateData.readBy = Array.from(set);
                    const shouldUpdateStatus = canApplyOutgoingMessageStatus(
                        outgoing.status,
                        nextStatus,
                    );
                    if (shouldUpdateStatus) {
                        updateData.status = nextStatus;
                    }

                    // If this receipt only contains unknown fields, skip DB write
                    if (Object.keys(updateData).length <= 2) return;

                    if (shouldUpdateStatus) {
                        const statusUpdate = await tx.outgoingMessage.updateMany({
                            where: {
                                pkId: outgoing.pkId,
                                status: {
                                    in: eligibleOutgoingMessageStatuses(nextStatus),
                                },
                            },
                            data: updateData,
                        });
                        if (statusUpdate.count > 0) {
                            await emitOutgoingStatus({
                                id: outgoing.id,
                                messageId: outgoing.id,
                                outgoingPkId: outgoing.pkId,
                                waMessageId: outgoing.waMessageId || key.id,
                                status: nextStatus,
                                to: outgoing.to,
                                conversationJid: outgoing.to,
                                isGroup: Boolean(outgoing.isGroup),
                                timestamp: new Date().toISOString(),
                                ...(set.size > 0
                                    ? { readCount: set.size, readBy: Array.from(set) }
                                    : {}),
                            });
                            return;
                        }

                        // The status changed after our read. Preserve receipt
                        // metadata, but never write the stale status decision.
                        delete updateData.status;
                        if (Object.keys(updateData).length <= 2) return;
                    }

                    const updatedOutgoing = await tx.outgoingMessage.update({
                        where: { pkId: outgoing.pkId },
                        data: updateData,
                    });
                    await emitOutgoingStatus({
                        id: updatedOutgoing.id,
                        messageId: updatedOutgoing.id,
                        outgoingPkId: updatedOutgoing.pkId,
                        waMessageId: updatedOutgoing.waMessageId || key.id,
                        status: updatedOutgoing.status,
                        to: updatedOutgoing.to,
                        conversationJid: updatedOutgoing.to,
                        isGroup: Boolean(updatedOutgoing.isGroup),
                        timestamp: new Date().toISOString(),
                        ...(Array.isArray(updatedOutgoing.readBy)
                            ? {
                                  readCount: updatedOutgoing.readBy.length,
                                  readBy: updatedOutgoing.readBy,
                              }
                            : {}),
                    });
                });
            } catch (e) {
                logger.error(e, 'An error occured during message receipt update');
            }
        }
    };

    const updateReaction: BaileysEventHandler<'messages.reaction'> = async (reactions) => {
        for (const { key, reaction } of reactions) {
            try {
                await prisma.$transaction(async (tx) => {
                    const message = await tx.message.findFirst({
                        select: { reactions: true },
                        where: { id: key.id!, remoteJid: key.remoteJid!, sessionId },
                    });
                    if (!message) {
                        return logger.debug(
                            { update: key },
                            'Got reaction update for non existent message',
                        );
                    }

                    const authorID = getKeyAuthor(reaction.key);
                    const reactions = ((message.reactions || []) as proto.IReaction[]).filter(
                        (r) => getKeyAuthor(r.key) !== authorID,
                    );

                    if (reaction.text) reactions.push(reaction);
                    await tx.message.update({
                        select: { pkId: true },
                        data: transformPrisma({ reactions: reactions }),
                        where: {
                            sessionId_remoteJid_id: {
                                id: key.id!,
                                remoteJid: key.remoteJid!,
                                sessionId,
                            },
                        },
                    });
                });
            } catch (e) {
                logger.error(e, 'An error occured during message reaction update');
            }

            // Inbox reaction persistence is intentionally independent from the
            // optional raw Message store above. Missing raw history must not
            // prevent the reaction from appearing in Inbox.
            try {
                await persistReaction(key, reaction);
            } catch (e) {
                logger.warn(
                    {
                        sessionId,
                        targetMessageId: key.id,
                        code: (e as { code?: unknown })?.code,
                    },
                    'Failed to persist Inbox reaction metadata',
                );
            }
        }
    };

    const deleteChats: BaileysEventHandler<'chats.delete'> = async (chatIds) => {
        try {
            // Hapus percakapan menggunakan Prisma
            await prisma.message.deleteMany({
                where: {
                    id: {
                        in: chatIds,
                    },
                },
            });
            logger.info({ chatIds }, 'Deleted chats');
        } catch (e) {
            logger.error(e, 'An error occurred during chat delete');
        }
    };

    const listen = () => {
        if (listening) return;

        // Deliberately do not listen to messaging-history.set. Inbox represents
        // activity recorded while this system is in use, not WhatsApp's old
        // account history. Live incoming/outgoing events use messages.upsert.
        event.on('messages.upsert', upsert);
        // Outgoing message ACK/NACK is handled once by the generation-aware
        // socket listener in whatsapp.ts. Registering this second handler made
        // both listeners race and could suppress the UUID status event used by
        // Inbox. Participant receipts remain handled below.
        event.on('messages.delete', del);
        event.on('message-receipt.update', updateReceipt);
        event.on('messages.reaction', updateReaction);
        event.on('chats.delete', deleteChats);
        listening = true;
    };

    const unlisten = () => {
        if (!listening) return;

        event.off('messages.upsert', upsert);
        event.off('messages.delete', del);
        event.off('message-receipt.update', updateReceipt);
        event.off('messages.reaction', updateReaction);
        event.off('chats.delete', deleteChats);
        listening = false;
    };

    return { listen, unlisten };
}
