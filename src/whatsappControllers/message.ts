/* eslint-disable @typescript-eslint/no-explicit-any */
import type {
    BaileysEventEmitter,
    MessageUserReceipt,
    proto,
    WAMessageKey,
} from '@whiskeysockets/baileys';
// import { jidNormalizedUser, toNumber } from '@whiskeysockets/baileys';
import { downloadMediaMessage, jidNormalizedUser } from '@whiskeysockets/baileys';
import logger from '../config/logger';
import prisma, { transformPrisma } from '../utils/db';
import { BaileysEventHandler } from '../types';
import { sendCampaignReply } from '../controllers/campaign';
import { sendOutsideBusinessHourMessage } from '../controllers/businessHour';
import fs from 'fs';
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
                        if (!message.broadcast) {
                            const jid = jidNormalizedUser(message.key.remoteJid!);
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
                                const dir = `media/S${sessionId}`;
                                if (!fs.existsSync(dir)) {
                                    fs.mkdirSync(dir, { recursive: true });
                                }

                                const io: Server = getSocketIO();

                                if (message.key.fromMe) {
                                    logger.warn({ sessionId, data }, 'outgoing messages');

                                    let status = 'pending';
                                    if (data.status >= 2) status = 'server_ack';
                                    if (data.status >= 3) status = 'delivery_ack';
                                    if (data.status >= 4) status = 'read';
                                    if (data.status >= 5) status = 'played';

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
                                    logger.warn({ sessionId, data }, 'incoming messages');
                                    if (!jid.includes('@g.us')) {
                                        sendOutsideBusinessHourMessage(sessionId, message);
                                    }
                                    sendCampaignReply(sessionId, message);

                                    const incomingMessage = await prisma.incomingMessage.create({
                                        data: {
                                            id: message.key.id!,
                                            from: jid,
                                            message: messageText,
                                            receivedAt: new Date(data.messageTimestamp * 1000),
                                            sessionId,
                                            contactId: contact?.pkId || null,
                                        },
                                        include: { contact: true },
                                    });

                                    io.emit(`message:${sessionId}`, incomingMessage);
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
                if (key.remoteJid != 'status@broadcast') {
                    await prisma.$transaction(async (tx) => {
                        const prevMessages = await tx.message.findFirst({
                            where: { id: key.id!, remoteJid: key.remoteJid!, sessionId },
                        });
                        const prevOutMessages = await tx.outgoingMessage.findFirst({
                            where: { id: key.id!, to: key.remoteJid!, sessionId },
                        });
                        if (!prevMessages || !prevOutMessages) {
                            return logger.info({ update }, 'Got update for non existent message');
                        }

                        const data = { ...prevMessages, ...update } as proto.IWebMessageInfo;
                        await tx.message.delete({
                            select: { pkId: true },
                            where: {
                                sessionId_remoteJid_id: {
                                    id: key.id!,
                                    remoteJid: key.remoteJid!,
                                    sessionId,
                                },
                            },
                        });
                        await tx.message.create({
                            select: { pkId: true },
                            data: {
                                ...transformPrisma(data),
                                id: data.key.id!,
                                remoteJid: data.key.remoteJid!,
                                sessionId,
                            },
                        });

                        let status;

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
                            default:
                                status = 'pending';
                                break;
                        }

                        if (key.fromMe) {
                            logger.warn({ sessionId, updates }, 'update outgoing message status');
                            await tx.outgoingMessage.update({
                                where: {
                                    sessionId_to_id: {
                                        id: key.id!,
                                        to: key.remoteJid!,
                                        sessionId,
                                    },
                                },
                                data: { status, updatedAt: new Date() },
                            });
                        }
                    });
                }
            } catch (e) {
                logger.error(e, 'An error occured during message update');
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
                        return logger.debug(
                            { update },
                            'Got receipt update for non existent message',
                        );
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
                            { update },
                            'Got reaction update for non existent message',
                        );
                    }

                    const authorID = getKeyAuthor(reaction.key);
                    const reactions = ((message.reactions || []) as proto.IReaction[]).filter(
                        (r) => getKeyAuthor(r.key) !== authorID,
                    );

                    // back here: Invalid value for argument `toInt`: We could not serialize [object Function] value.
                    // Serialize the object to JSON or implement a \".toJSON()\" method on it.
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
            // Lakukan penghapusan percakapan menggunakan Prisma
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

        // event.on('messaging-history.set', set);
        event.on('messages.upsert', upsert);
        // event.on('messages.update', update);
        event.on('messages.delete', del);
        event.on('message-receipt.update', updateReceipt);
        event.on('messages.reaction', updateReaction);
        event.on('chats.delete', deleteChats);
        listening = true;
    };

    const unlisten = () => {
        if (!listening) return;

        event.off('messaging-history.set', set);
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
