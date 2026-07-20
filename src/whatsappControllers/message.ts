/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
    BaileysEventEmitter,
    MessageUserReceipt,
    proto,
    WAMessageKey,
} from '@whiskeysockets/baileys';
import { downloadMediaMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import logger from '../config/logger';
import prisma, { transformPrisma } from '../utils/db';
import { BaileysEventHandler } from '../types';
import { sendCampaignReply } from '../controllers/campaign';
import { sendOutsideBusinessHourMessage } from '../controllers/businessHour';
import fs from 'fs';
import path from 'path';
import { getSocketIO } from '../socket';
import { Server } from 'socket.io';
import { safeMessageContext, redactPhone, redactMessageObject } from '../utils/logRedaction';
import { encryptMessage, decryptOutgoingMessage } from '../utils/messageEncryption';
import { getInstance } from '../whatsapp';

const getKeyAuthor = (key: WAMessageKey | undefined | null) =>
    (key?.fromMe ? 'me' : key?.participant || key?.remoteJid) || '';

export default function messageHandler(sessionId: string, event: BaileysEventEmitter, deviceId?: number) {
    let listening = false;

    // obtain messages history
    const set: BaileysEventHandler<'messaging-history.set'> = async ({ messages, isLatest }) => {
        try {
            await prisma.$transaction(async (tx) => {
                if (isLatest) await tx.message.deleteMany({ where: { sessionId } });

                await tx.message.createMany({
                    data: messages.map((message: { key: { remoteJid: any; id: any } }) => ({
                        ...transformPrisma(message),
                        remoteJid: message.key.remoteJid!,
                        id: message.key.id!,
                        sessionId,
                    })),
                });
            });
            logger.info({ messages: messages.length }, 'Synced messages');
        } catch (e) {
            logger.error(e, 'An error occured during messages set');
        }
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
                        const jid = jidNormalizedUser(remoteJidRaw);
                        const data = transformPrisma(message);

                        const messageText =
                            data.message?.conversation ||
                            data.message?.extendedTextMessage?.text ||
                            data.message?.imageMessage?.caption ||
                            data.message?.documentMessage?.caption ||
                            '';

                        // CEK: Jika pesan outgoing (fromMe), pastikan hanya simpan jika ada di outgoingMessage
                        if (message.key.fromMe) {
                            const outgoingExists = await prisma.outgoingMessage.findFirst({
                                where: {
                                    OR: [
                                        { id: message.key.id! },
                                        { waMessageId: message.key.id!, sessionId },
                                    ],
                                },
                            });
                            if (!outgoingExists) {
                                // Pesan outgoing dari luar sistem, jangan simpan
                                continue;
                            }
                        }

                        const contact = await prisma.contact.findFirst({
                            where: {
                                phone: jid.split('@')[0],
                                contactDevices: {
                                    some: { device: { sessions: { some: { sessionId } } } },
                                },
                            },
                        });

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
                                            { waMessageId: message.key.id!, sessionId },
                                            { id: message.key.id!, sessionId },
                                        ],
                                    },
                                    select: { pkId: true, status: true, waMessageId: true },
                                });

                                // Define status hierarchy for comparison
                                const statusHierarchy = {
                                    pending: 1,
                                    error: 1,
                                    server_ack: 2,
                                    delivery_ack: 3,
                                    read: 4,
                                    played: 5,
                                };

                                // Only update if new status is higher than current status
                                const currentLevel =
                                    statusHierarchy[
                                        currentMessage?.status as keyof typeof statusHierarchy
                                    ] || 0;
                                const newLevel =
                                    statusHierarchy[status as keyof typeof statusHierarchy] || 0;

                                const shouldUpdate = !currentMessage || newLevel > currentLevel;

                                if (shouldUpdate) {
                                    if (currentMessage?.pkId) {
                                        const outgoingMessage = await prisma.outgoingMessage.update({
                                            where: { pkId: currentMessage.pkId },
                                            data: {
                                                status,
                                                waMessageId: currentMessage.waMessageId || message.key.id!,
                                                updatedAt: new Date(),
                                            },
                                            include: { contact: true },
                                        });
                                        io.emit(`message:${sessionId}`, outgoingMessage);
                                    } else {
                                        // ⚠️ CRITICAL FIX: Check existing message before upsert to prevent downgrade
                                        const existingMessage = await prisma.outgoingMessage.findFirst({
                                            where: { id: message.key.id!, sessionId },
                                            select: { pkId: true, status: true },
                                        });
                                        
                                        // If message exists, check status hierarchy before update
                                        if (existingMessage) {
                                            const existingLevel = statusHierarchy[existingMessage.status as keyof typeof statusHierarchy] || 0;
                                            
                                            // Only update if new status is higher
                                            if (newLevel > existingLevel) {
                                                await prisma.outgoingMessage.update({
                                                    where: { pkId: existingMessage.pkId },
                                                    data: {
                                                        status,
                                                        waMessageId: message.key.id!,
                                                        updatedAt: new Date(),
                                                    },
                                                });
                                                
                                                const updatedMessage = await prisma.outgoingMessage.findUnique({
                                                    where: { pkId: existingMessage.pkId },
                                                    include: { contact: true },
                                                });
                                                
                                                if (updatedMessage) {
                                                    io.emit(`message:${sessionId}`, updatedMessage);
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
                                                    contactId: contact?.pkId || null,
                                                },
                                                include: { contact: true },
                                            });
                                            io.emit(`message:${sessionId}`, outgoingMessage);
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
                                    const participant = message.key.participant || null;
                                    
                                    // Get group name and picture if it's a group message
                                    let groupName: string | null = null;
                                    let groupPicUrl: string | null = null;
                                    
                                    const session = getInstance(sessionId);
                                    
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
                                            message: messageText,
                                            receivedAt: new Date(Number(data.messageTimestamp) * 1000),
                                            sessionId,
                                            deviceId: deviceId || null,
                                            contactId: contact?.pkId || null,
                                        },
                                        update: {
                                            // Update metadata if changed
                                            groupName,
                                            pushName,
                                        },
                                        include: { contact: true },
                                    });
                                    
                                    // ✅ BACKGROUND: Fetch dan update profile/group pictures (non-blocking)
                                    (async () => {
                                        try {
                                            let picUrlToUpdate: string | null = null;
                                            let fieldToUpdate: 'profilePicUrl' | 'groupPicUrl' = 'profilePicUrl';
                                            
                                            if (jid.includes('@g.us')) {
                                                // GROUP: Fetch group picture
                                                if (session && typeof session.profilePictureUrl === 'function') {
                                                    try {
                                                        const picUrl = await session.profilePictureUrl(jid, 'image');
                                                        picUrlToUpdate = picUrl || null;
                                                        fieldToUpdate = 'groupPicUrl';
                                                    } catch {
                                                        // Group might not have a profile picture
                                                        picUrlToUpdate = null;
                                                    }
                                                }
                                            } else {
                                                // PERSONAL: Fetch profile picture
                                                if (session && typeof session.profilePictureUrl === 'function') {
                                                    try {
                                                        const picUrl = await session.profilePictureUrl(jid, 'image');
                                                        picUrlToUpdate = picUrl || null;
                                                        fieldToUpdate = 'profilePicUrl';
                                                    } catch {
                                                        // User might not have a profile picture
                                                        picUrlToUpdate = null;
                                                    }
                                                }
                                            }
                                            
                                            // Update database if picture found
                                            if (picUrlToUpdate) {
                                                const updateData: { profilePicUrl?: string; groupPicUrl?: string } = {};
                                                if (fieldToUpdate === 'profilePicUrl') {
                                                    updateData.profilePicUrl = picUrlToUpdate;
                                                } else {
                                                    updateData.groupPicUrl = picUrlToUpdate;
                                                }
                                                
                                                await prisma.incomingMessage.update({
                                                    where: { id: message.key.id! },
                                                    data: updateData,
                                                });
                                                
                                                // Emit updated message with picture
                                                const updatedMessage = await prisma.incomingMessage.findUnique({
                                                    where: { id: message.key.id! },
                                                    include: { contact: true },
                                                });
                                                
                                                if (updatedMessage) {
                                                    const emitEventName = `incoming:${sessionId}:profile-updated`;
                                                    io.emit(emitEventName, {
                                                        ...updatedMessage,
                                                        isGroup: jid.includes('@g.us'),
                                                    });
                                                }
                                                
                                                logger.debug({ 
                                                    jid, 
                                                    field: fieldToUpdate,
                                                    picUrl: picUrlToUpdate.substring(0, 50) 
                                                }, '✅ Picture updated in background');
                                            }
                                        } catch (picErr) {
                                            logger.debug({ jid, picErr }, '❌ Background picture fetch failed');
                                        }
                                    })();

                                    // Emit socket event untuk real-time update
                                    const emitEventName = `incoming:${sessionId}`;
                                    const emitPayload = {
                                        ...incomingMessage,
                                        isGroup: jid.includes('@g.us'),
                                    };
                                    
                                    io.emit(emitEventName, emitPayload);
                                    
                                    logger.info(
                                        { 
                                            sessionId, 
                                            from: jid, 
                                            participant, 
                                            pushName, 
                                            groupName, 
                                            messageId: message.key.id,
                                            socketEventEmitted: emitEventName,
                                            connectedClients: io.sockets.sockets.size
                                        },
                                        'Incoming message saved and socket event emitted'
                                    );
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
                        const isGroupMessage = key.remoteJid?.includes('@g.us');
                        const queryTo = key.remoteJid!;
                        
                        // ✅ Query dengan filter 'to' yang tepat
                        const outgoingByWaId = await tx.outgoingMessage.findFirst({
                            where: { 
                                waMessageId: key.id!, 
                                to: queryTo,  // For group: group@g.us, For personal: recipient JID
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
                                      to: queryTo,
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
                            
                            // Define status hierarchy for comparison
                            const statusHierarchy = {
                                pending: 1,
                                error: 1,
                                server_ack: 2,
                                delivery_ack: 3,
                                read: 4,
                                played: 5,
                            };

                            // Only update if new status is higher than current status
                            const currentLevel =
                                statusHierarchy[
                                    outgoingMessage.status as keyof typeof statusHierarchy
                                ] || 0;
                            const newLevel =
                                statusHierarchy[status as keyof typeof statusHierarchy] || 0;

                            logger.info(
                                {
                                    sessionId,
                                    messageId: key.id,
                                    currentStatus: outgoingMessage.status,
                                    currentLevel,
                                    newStatus: status,
                                    newLevel,
                                    willUpdate: newLevel > currentLevel,
                                },
                                '🔍 Status hierarchy check'
                            );

                            if (newLevel > currentLevel) {
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
                                const updatedMessage = await tx.outgoingMessage.update({
                                    where: { pkId: outgoingMessage.pkId },
                                    data: updateData,
                                });
                                
                                // ✅ EMIT socket event for real-time status update (ONLY on upgrade)
                                if (deviceId) {
                                    const io = getSocketIO();
                                    const eventPayload: any = {
                                        waMessageId: updatedMessage.waMessageId || key.id!,
                                        status: updatedMessage.status,
                                        timestamp: new Date().toISOString(),
                                    };
                                    
                                    // ✅ For group messages: include readBy count
                                    if (outgoingMessage.isGroup && Array.isArray(updateData.readBy)) {
                                        eventPayload.readCount = updateData.readBy.length;
                                        eventPayload.readBy = updateData.readBy;
                                    }
                                    
                                    io.emit(`device:${deviceId}:message-status`, eventPayload);
                                    
                                    logger.info(
                                        {
                                            sessionId,
                                            deviceId,
                                            waMessageId: updatedMessage.waMessageId,
                                            status: updatedMessage.status,
                                            readCount: eventPayload.readCount,
                                            isGroup: outgoingMessage.isGroup,
                                            eventEmitted: `device:${deviceId}:message-status`
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
                                        'Cannot emit status update - deviceId is undefined'
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

                    const statusHierarchy: Record<string, number> = {
                        pending: 1,
                        error: 1,
                        server_ack: 2,
                        delivery_ack: 3,
                        read: 4,
                        played: 5,
                    };

                    let nextStatus = outgoing.status;
                    if (hasRead) nextStatus = 'read';
                    else if (hasDeliver) nextStatus = 'delivery_ack';

                    const currentLevel = statusHierarchy[String(outgoing.status || 'pending')] || 0;
                    const nextLevel = statusHierarchy[String(nextStatus || 'pending')] || 0;

                    const updateData: any = {
                        waMessageId: outgoing.waMessageId || key.id,
                        updatedAt: new Date(),
                    };

                    if (hasRead && set.size) updateData.readBy = Array.from(set);
                    if (nextLevel > currentLevel) updateData.status = nextStatus;

                    // If this receipt only contains unknown fields, skip DB write
                    if (Object.keys(updateData).length <= 2) return;

                    await tx.outgoingMessage.update({
                        where: { pkId: outgoing.pkId },
                        data: updateData,
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

        // Jika ingin mengaktifkan messaging-history.set, uncomment kedua baris ini (on & off)
        // event.on('messaging-history.set', set);
        event.on('messages.upsert', upsert);
        event.on('messages.update', update);
        event.on('messages.delete', del);
        event.on('message-receipt.update', updateReceipt);
        event.on('messages.reaction', updateReaction);
        event.on('chats.delete', deleteChats);
        listening = true;
    };

    const unlisten = () => {
        if (!listening) return;

        // event.off('messaging-history.set', set);
        event.off('messages.upsert', upsert);
        event.off('messages.update', update);
        event.off('messages.delete', del);
        event.off('message-receipt.update', updateReceipt);
        event.off('messages.reaction', updateReaction);
        event.off('chats.delete', deleteChats);
        listening = false;
    };

    return { listen, unlisten };
}
