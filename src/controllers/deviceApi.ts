import { RequestHandler } from 'express';
import { getInstance, verifyJid, sendButtonMessage, sendMediaFile, getJid } from '../whatsapp';
import logger from '../config/logger';
import prisma, { serializePrisma } from '../utils/db';
import { delay as delayMs } from '../utils/delay';
import { proto } from '@whiskeysockets/baileys';
import { diskUpload, memoryUpload } from '../config/multer';
import { isUUID } from '../utils/uuidChecker';
import fs from 'fs';
import { addWeeks, format } from 'date-fns'; // Anda bisa menggunakan date-fns atau moment.js untuk manipulasi tanggal

export const sendMessages: RequestHandler = async (req, res) => {
    try {
        const sessionId = req.authenticatedDevice.sessionId;
        const session = getInstance(sessionId)!;
        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const results: { index: number; result?: proto.WebMessageInfo }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [
            index,
            { recipient, type = 'number', delay = 5000, message, options },
        ] of req.body.entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, type);

                const startTime = new Date().getTime();
                if (index > 0) await delayMs(delay);
                const endTime = new Date().getTime();
                const delayElapsed = endTime - startTime;
                logger.info(`Delay of ${delay} milliseconds elapsed: ${delayElapsed} milliseconds`);

                const result = await session.sendMessage(jid, message, options);
                results.push({ index, result });
            } catch (e) {
                const message =
                    e instanceof Error ? e.message : 'An error occurred during message send';
                logger.error(e, message);
                errors.push({ index, error: message });
            }
        }

        res.status(errors.length > 0 ? 500 : 200).json({
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

            const startTime = new Date().getTime();
            if (recipients.length > 0) await delayMs(delay);
            const endTime = new Date().getTime();
            const delayElapsed = endTime - startTime;
            logger.info(`Delay of ${delay} milliseconds elapsed: ${delayElapsed} milliseconds`);

            const { results, errors } = await sendMediaFile(
                session,
                recipients,
                fileData,
                fileType,
                caption,
            );

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

            const startTime = new Date().getTime();
            if (recipients.length > 0) await delayMs(delay);
            const endTime = new Date().getTime();
            const delayElapsed = endTime - startTime;
            logger.info(`Delay of ${delay} milliseconds elapsed: ${delayElapsed} milliseconds`);

            const { results, errors } = await sendMediaFile(
                session,
                recipients,
                fileData,
                fileType,
                caption,
            );

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

            const startTime = new Date().getTime();
            if (recipients.length > 0) await delayMs(delay);
            const endTime = new Date().getTime();
            const delayElapsed = endTime - startTime;
            logger.info(`Delay of ${delay} milliseconds elapsed: ${delayElapsed} milliseconds`);

            const { results, errors } = await sendMediaFile(
                session,
                recipients,
                fileData,
                fileType,
                caption,
            );

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

            const startTime = new Date().getTime();
            if (recipients.length > 0) await delayMs(delay);
            const endTime = new Date().getTime();
            const delayElapsed = endTime - startTime;
            logger.info(`Delay of ${delay} milliseconds elapsed: ${delayElapsed} milliseconds`);

            const { results, errors } = await sendMediaFile(
                session,
                recipients,
                fileData,
                fileType,
                caption,
            );

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
        ).map((m) => serializePrisma(m));

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

        res.status(200).json({
            data: messages.map((m) => serializePrisma(m)),
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

export const createBroadcast: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }
            const { deviceId } = req.authenticatedDevice;
            const { name, recipients, message, schedule } = req.body;
            const delay = Number(req.body.delay) ?? 5000;

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
            await prisma.$transaction(async (transaction) => {
                await transaction.broadcast.create({
                    data: {
                        name,
                        message,
                        schedule,
                        deviceId: device.pkId,
                        delay,
                        recipients: {
                            set: recipients,
                        },
                        mediaPath: req.file?.path,
                    },
                });
                res.status(201).json({ message: 'Broadcast created successfully' });
            });
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
                return res.status(400).json({ message: 'Error uploading file' });
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
        res.status(200).json(broadcasts);
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

        res.status(200).json(uniqueBroadcasts);
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
        const allMessages: Message[] = [...incomingMessages, ...outgoingMessages];
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
        logger.debug(allMessages);

        // Sort the combined messages by timestamp (receivedAt or createdAt)
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
        // jangan tampilkan data yang null dan masukkan dalam array
        for (const message of allMessages) {
            if (message.mediaPath) {
                mediaPath.push(message.mediaPath);
            }
        }

        // Create a zip file
        const JSZip = require('jszip');
        const zip = new JSZip();
        // const dataString = JSON.stringify(dataMessages, null, 2);
        zip.file('messages.txt', dataMessages.toString());
        zip.folder('media');
        const folderMedia = zip.folder('media');
        if (folderMedia) {
            mediaPath.forEach((image, index) => {
                // Menambahkan file ke ZIP
                const imageBuffer = fs.readFileSync(image); // Read the image file
                folderMedia.file(`${index}.jpg`, imageBuffer); // Add the image file to the ZIP
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

            // Mendapatkan semua grup dari sesi
            const groups = await session.groupFetchAllParticipating();

            // Format hasil grup
            const results = Object.entries(groups).map(([groupId, groupInfo]) => ({
                id: groupId,
                name: groupInfo.subject || 'Unnamed Group',
            }));

            return res.status(200).json({ results });
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

export const createBroadcastFeedback: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }

            const { deviceId } = req.authenticatedDevice;
            const { courseName, startLesson = 1, recipients } = req.body;
            const delay = Number(req.body.delay) ?? 5000;

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

            const now = new Date();

            await prisma.$transaction(async (transaction) => {
                for (let i = 0; i < courseFeedbacks.length; i++) {
                    const feedback = courseFeedbacks[i];
                    const schedule = new Date(now);
                    schedule.setDate(schedule.getDate() + i * 7); // Tambahkan 1 minggu untuk setiap lesson

                    await transaction.broadcast.create({
                        data: {
                            name: `${courseName} - Recipients ${recipients}`,
                            message: feedback.message,
                            schedule,
                            deviceId: device.pkId,
                            delay,
                            recipients: {
                                set: recipients,
                            },
                            mediaPath: req.file?.path,
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

export const createBroadcastReminder: RequestHandler = async (req, res) => {
    try {
        diskUpload.single('media')(req, res, async (err: any) => {
            if (err) {
                return res.status(400).json({ message: 'Error uploading file' });
            }

            const { deviceId } = req.authenticatedDevice;
            const { courseName, startLesson = 1, recipients } = req.body;
            const delay = Number(req.body.delay) ?? 5000;

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
                            message: reminder.message,
                            schedule,
                            deviceId: device.pkId,
                            delay,
                            recipients: {
                                set: recipients,
                            },
                            mediaPath: req.file?.path,
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
                return res.status(400).json({ message: 'Error uploading file' });
            }

            const { deviceId } = req.authenticatedDevice;
            const { name, recipients, message, recurrence, interval, startDate, endDate } =
                req.body;
            const delay = Number(req.body.delay) ?? 5000;

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
                    name: name,
                    message,
                    schedule: new Date(current),
                    deviceId: device.pkId,
                    delay,
                    recipients: { set: recipients },
                    mediaPath: req.file?.path,
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

            res.status(201).json({
                message: 'Broadcasts created successfully',
                totalBroadcasts: broadcasts.length,
            });
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
