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

    // back here: check the type: campaign? broadcast? dm?
    const upsert: BaileysEventHandler<'messages.upsert'> = async ({ messages, type }) => {
        switch (type) {
            case 'append':
            case 'notify':
                for (const message of messages) {
                    try {
                        if (!message.broadcast) {
                            const jid = jidNormalizedUser(message.key.remoteJid!);
                            // back here: what's transformPrisma() for?
                            const data = transformPrisma(message);
                            const messageText =
                                data.message?.conversation ||
                                data.message?.extendedTextMessage?.text ||
                                data.message?.imageMessage?.caption ||
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
                                    phone: jidNormalizedUser(message.key.remoteJid!).split('@')[0],
                                    contactDevices: {
                                        some: { device: { sessions: { some: { sessionId } } } },
                                    },
                                },
                            });

                            if (data.message && !data.message.protocolMessage) {
                                const dir = `media/S${sessionId}`;
                                if (!fs.existsSync(dir)) {
                                    try {
                                        fs.mkdirSync(dir, { recursive: true });
                                    } catch (err) {
                                        console.error('Error creating directory:', err);
                                    }
                                }

                                const io: Server = getSocketIO();

                                if (message.key.fromMe) {
                                    logger.warn({ sessionId, data }, 'outgoing messages');
                                    let status;

                                    switch (data.status) {
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

                                    const outgoingMessage = await prisma.outgoingMessage.create({
                                        data: {
                                            id: message.key.id!,
                                            to: jidNormalizedUser(message.key.remoteJid!),
                                            message: messageText,
                                            schedule: new Date(),
                                            status,
                                            sessionId,
                                            contactId: contact?.pkId || null,
                                        },
                                        include: {
                                            contact: {
                                                select: {
                                                    id: true,
                                                    firstName: true,
                                                    lastName: true,
                                                    colorCode: true,
                                                },
                                            },
                                        },
                                    });

                                    if (data.message.imageMessage) {
                                        const outputFilePath = data.message.imageMessage.fileName
                                            ? `${dir}/${
                                                  outgoingMessage.id
                                              }.${data.message.imageMessage.fileName
                                                  .split('.')
                                                  .pop()}`
                                            : `${dir}/${
                                                  outgoingMessage.id
                                              }.${data.message.imageMessage.mimetype
                                                  .split('/')
                                                  .pop()}`;
                                        const buffer = (await downloadMediaMessage(
                                            message,
                                            'buffer',
                                            {},
                                        )) as Buffer;

                                        fs.writeFile(outputFilePath, buffer, (err: any) => {
                                            if (err) throw err;
                                            logger.warn('save img');
                                        });

                                        await prisma.outgoingMessage.update({
                                            where: { id: outgoingMessage.id },
                                            data: { mediaPath: outputFilePath },
                                        });
                                    } else if (data.message.documentMessage) {
                                        const outputFilePath = data.message.documentMessage.fileName
                                            ? `${dir}/${
                                                  outgoingMessage.id
                                              }.${data.message.documentMessage.fileName
                                                  .split('.')
                                                  .pop()}`
                                            : `${dir}/${
                                                  outgoingMessage.id
                                              }.${data.message.documentMessage.mimetype
                                                  .split('/')
                                                  .pop()}`;
                                        const buffer = (await downloadMediaMessage(
                                            message,
                                            'buffer',
                                            {},
                                        )) as Buffer;

                                        fs.writeFile(outputFilePath, buffer, (err: any) => {
                                            if (err) throw err;
                                            logger.warn('save doc');
                                        });

                                        await prisma.outgoingMessage.update({
                                            where: { id: outgoingMessage.id },
                                            data: { mediaPath: outputFilePath },
                                        });
                                    }

                                    io.emit(`message:${sessionId}`, outgoingMessage);
                                } else {
                                    logger.warn({ sessionId, data }, 'incoming messages');
                                    if (!message.key.remoteJid.includes('@g.us')) {
                                        sendOutsideBusinessHourMessage(sessionId, message);
                                    }
                                    sendCampaignReply(sessionId, message);

                                    const incomingMessage = await prisma.incomingMessage.create({
                                        data: {
                                            id: message.key.id!,
                                            from: jidNormalizedUser(message.key.remoteJid!),
                                            message: messageText,
                                            receivedAt: new Date(data.messageTimestamp * 1000),
                                            sessionId,
                                            contactId: contact?.pkId || null,
                                        },
                                        include: {
                                            contact: {
                                                select: {
                                                    id: true,
                                                    firstName: true,
                                                    lastName: true,
                                                    colorCode: true,
                                                },
                                            },
                                        },
                                    });

                                    if (data.message.imageMessage) {
                                        const outputFilePath = data.message.imageMessage.fileName
                                            ? `${dir}/${
                                                  incomingMessage.id
                                              }.${data.message.imageMessage.fileName
                                                  .split('.')
                                                  .pop()}`
                                            : `${dir}/${
                                                  incomingMessage.id
                                              }.${data.message.imageMessage.mimetype
                                                  .split('/')
                                                  .pop()}`;
                                        const buffer = (await downloadMediaMessage(
                                            message,
                                            'buffer',
                                            {},
                                        )) as Buffer;

                                        fs.writeFile(outputFilePath, buffer, (err: any) => {
                                            if (err) throw err;
                                            logger.warn('save img');
                                        });
                                        await prisma.incomingMessage.update({
                                            where: { id: incomingMessage.id },
                                            data: { mediaPath: outputFilePath },
                                        });
                                    } else if (data.message.documentMessage) {
                                        const outputFilePath = data.message.documentMessage.fileName
                                            ? `${dir}/${
                                                  incomingMessage.id
                                              }.${data.message.documentMessage.fileName
                                                  .split('.')
                                                  .pop()}`
                                            : `${dir}/${
                                                  incomingMessage.id
                                              }.${data.message.documentMessage.mimetype
                                                  .split('/')
                                                  .pop()}`;
                                        const buffer = (await downloadMediaMessage(
                                            message,
                                            'buffer',
                                            {},
                                        )) as Buffer;

                                        fs.writeFile(outputFilePath, buffer, (err: any) => {
                                            if (err) throw err;
                                            logger.warn('save doc');
                                        });

                                        await prisma.incomingMessage.update({
                                            where: { id: incomingMessage.id },
                                            data: { mediaPath: outputFilePath },
                                        });
                                    }

                                    io.emit(`message:${sessionId}`, incomingMessage);
                                }
                            }
                            //   const chatExists = (await prisma.chat.count({ where: { id: jid, sessionId } })) > 0;
                            //   if (type === 'notify' && !chatExists) {
                            //     event.emit('chats.upsert', [
                            //       {
                            //         id: jid,
                            //         conversationTimestamp: toNumber(message.messageTimestamp),
                            //         unreadCount: 1,
                            //       },
                            //     ]);
                            //   }
                        }
                    } catch (e) {
                        logger.error(e, 'An error occured during message upsert');
                    }
                }
                break;
        }
    };

    // back here: update the timestamp
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
                                data: { status },
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

    const listen = () => {
        if (listening) return;

        event.on('messaging-history.set', set);
        event.on('messages.upsert', upsert);
        event.on('messages.update', update);
        event.on('messages.delete', del);
        event.on('message-receipt.update', updateReceipt);
        event.on('messages.reaction', updateReaction);
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
        listening = false;
    };

    return { listen, unlisten };
}
