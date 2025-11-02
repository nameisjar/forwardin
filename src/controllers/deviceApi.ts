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
        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const session = getInstance(sessionId)!;
        if (!session) {
            return res.status(400).json({ message: 'Session not found' });
        }

        const results: { index: number; result?: any }[] = [];
        const errors: { index: number; error: string }[] = [];

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

                    // simple validation: group JID harus mengandung '-' sebelum @g.us
                    // format sah: <digits>-<digits>@g.us
                    const beforeAt = jid.split('@')[0];
                    if (!beforeAt.includes('-')) {
                        // berikan pesan error jelas: biasanya grup JID harus mengandung '-'
                        throw new Error(
                            'Invalid group JID. A WhatsApp group JID must contain a hyphen (e.g. 12345-67890@g.us). ' +
                                'If you only have the numeric id, include the hyphen part (group id).',
                        );
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

                // kirim pesan. Banyak wrapper Baileys menggunakan sendMessage(jid, payload, options)
                const result = await session.sendMessage(jid, payload, options ?? undefined);
                results.push({ index, result });
            } catch (e) {
                const msg = e instanceof Error ? e.message : String(e);
                logger.error(e, `Failed to send message at index ${index}: ${msg}`);
                errors.push({ index, error: msg });
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

        const { recipient, resolution } = req.query as { recipient?: string; resolution?: string };
        if (!recipient) return res.status(400).json({ message: 'Recipient is required' });

        const jid = getJid(recipient);
        await verifyJid(session, jid, 'number');

        const ppUrl = await session.profilePictureUrl(
            jid,
            resolution === 'high' ? 'image' : undefined,
        );

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
                    const deleteMessageResult = await session.sendMessage(jid, { delete: key });
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
                    const updateMessageResult = await session.sendMessage(jid, {
                        text: newText,
                        edit: key,
                    });
                    results.push({ index, result: updateMessageResult });
                    await prisma.outgoingMessage.update({
                        where: { sessionId: sessionId, id: messageId } as any,
                        data: { message: newText },
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
                return res.status(400).json({ message: 'Error uploading file' });
            }
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
                        message,
                        schedule,
                        deviceId: device.pkId,
                        delay,
                        recipients: { set: recipients },
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
                            name: courseName,
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
            const { name, message, recurrence, interval, startDate, endDate } = req.body;
            const delay = Number(req.body.delay) ?? 5000;

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
                    name: name.includes('[Reminder]') ? name : `${name} [Reminder]`,
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
