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

const getKeyAuthor = (key: WAMessageKey | undefined | null) =>
    (key?.fromMe ? 'me' : key?.participant || key?.remoteJid) || '';

export default function messageHandler(sessionId: string, event: BaileysEventEmitter) {
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
                        console.log(data);

                        const messageText =
                            data.message?.conversation ||
                            data.message?.extendedTextMessage?.text ||
                            data.message?.imageMessage?.caption ||
                            data.message?.documentMessage?.caption ||
                            '';

                        await prisma.message.upsert({
                            select: { pkId: true },
                            create: { ...data, remoteJid: jid, id: message.key.id!, sessionId },
                            update: { ...data },
                            where: {
                                sessionId_remoteJid_id: {
                                    remoteJid: jid,
                                    id: message.key.id!,
                                    sessionId,
                                },
                            },
                        });

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
                                logger.warn({ sessionId, data }, 'outgoing messages');

                                let status = 'pending';
                                if (data.status >= 2) status = 'server_ack';
                                if (data.status >= 3) status = 'delivery_ack';
                                if (data.status >= 4) status = 'read';
                                if (data.status >= 5) status = 'played';

                                // Get current status to prevent degradation
                                const currentMessage = await prisma.outgoingMessage.findFirst({
                                    where: { id: message.key.id! },
                                    select: { status: true },
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
                                    const outgoingMessage = await prisma.outgoingMessage.upsert({
                                        where: { id: message.key.id! },
                                        update: { status },
                                        create: {
                                            id: message.key.id!,
                                            to: jid,
                                            message: messageText,
                                            schedule: new Date(),
                                            status,
                                            sessionId,
                                            contactId: contact?.pkId || null,
                                        },
                                        include: { contact: true },
                                    });

                                    io.emit(`message:${sessionId}`, outgoingMessage);
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
                                logger.warn({ sessionId, data }, 'incoming messages');
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
                                // pesan masuk tidak disimpan untuk sementara waktu
                                // const incomingMessage = await prisma.incomingMessage.create({
                                //     data: {
                                //         id: message.key.id!,
                                //         from: jid,
                                //         message: messageText,
                                //         receivedAt: new Date(data.messageTimestamp * 1000),
                                //         sessionId,
                                //         contactId: contact?.pkId || null,
                                //     },
                                //     include: { contact: true },
                                // });

                                // io.emit(`message:${sessionId}`, incomingMessage);
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
                        // First, try to find the outgoing message directly by ID
                        const prevOutMessages = await tx.outgoingMessage.findFirst({
                            where: { id: key.id!, sessionId },
                        });

                        // If no direct match, try to find by the composite key (for older messages)
                        const prevOutMessagesByComposite = !prevOutMessages
                            ? await tx.outgoingMessage.findFirst({
                                  where: { id: key.id!, to: key.remoteJid!, sessionId },
                              })
                            : null;

                        const outgoingMessage = prevOutMessages || prevOutMessagesByComposite;

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

                            if (newLevel > currentLevel) {
                                logger.info(
                                    {
                                        sessionId,
                                        messageId: key.id,
                                        newStatus: status,
                                        oldStatus: outgoingMessage.status,
                                    },
                                    'Updating outgoing message status to higher level',
                                );

                                try {
                                    await tx.outgoingMessage.update({
                                        where: { id: key.id! },
                                        data: { status, updatedAt: new Date() },
                                    });
                                } catch (updateError) {
                                    // Fallback to composite key update if direct ID update fails
                                    await tx.outgoingMessage.updateMany({
                                        where: {
                                            id: key.id!,
                                            to: key.remoteJid!,
                                            sessionId,
                                        },
                                        data: { status, updatedAt: new Date() },
                                    });
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
                                },
                                'Received status update for unknown outgoing message',
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
                    const message = await tx.message.findFirst({
                        select: { userReceipt: true },
                        where: { id: key.id!, remoteJid: key.remoteJid!, sessionId },
                    });
                    if (!message) {
                        return logger.debug({ key }, 'Got receipt update for non existent message');
                    }

                    let userReceipt = (message.userReceipt ||
                        []) as unknown as MessageUserReceipt[];
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
