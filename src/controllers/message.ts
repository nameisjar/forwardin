import { RequestHandler } from 'express';
import { getInstance, verifyJid, sendButtonMessage, sendMediaFile, getJid } from '../whatsapp';
import logger from '../config/logger';
import prisma, { serializePrisma } from '../utils/db';
import { delay as delayMs } from '../utils/delay';
import { proto } from '@whiskeysockets/baileys';
import { memoryUpload } from '../config/multer';
import { isUUID } from '../utils/uuidChecker';
import fs from 'fs';
import { createZipFile } from '../utils/zip';
import { time } from 'console';

export const sendMessages: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const results: { index: number; result?: any }[] = [];
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
        const session = getInstance(req.params.sessionId)!;

        if (!isUUID(req.params.sessionId)) {
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
        const session = getInstance(req.params.sessionId)!;

        if (!isUUID(req.params.sessionId)) {
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
        const session = getInstance(req.params.sessionId)!;

        if (!isUUID(req.params.sessionId)) {
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

            res.status(errors.length > 0 ? 500 : 200).json({ results, errors });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const sendVideoMessages: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;

        if (!isUUID(req.params.sessionId)) {
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

            res.status(errors.length > 0 ? 500 : 200).json({ results, errors });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const sendButton: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId)!;
        const to = req.body.to;
        const data = req.body.data;

        if (!isUUID(req.params.sessionId)) {
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
        const { sessionId } = req.params;
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
        const { sessionId } = req.params;
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
        const { sessionId } = req.params;
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
        const { sessionId } = req.params;
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

export const exportMessagesToZip: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { phoneNumber, contactName, sort } = req.query;

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
            where: { sessionId },
            select: {
                device: {
                    select: { phone: true },
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

        const sortedMessages = allMessages.sort((a, b) =>
            sort === 'asc'
                ? a.createdAt.getTime() - b.createdAt.getTime()
                : b.createdAt.getTime() - a.createdAt.getTime(),
        );

        let dataMessages = '';
        for (const message of sortedMessages) {
            if ('receivedAt' in message) {
                dataMessages += `${message.receivedAt} - ${message.phone}: ${message.message} \n`;
            } else {
                dataMessages += `${message.createdAt} - ${message.phone}: ${message.message}\n`;
            }
        }

        const mediaPaths = sortedMessages
            .filter((m) => m.mediaPath)
            .map((m) => m.mediaPath as string);

        const zipContent = await createZipFile(dataMessages, mediaPaths);

        res.set('Content-Type', 'application/zip');
        res.set(
            'Content-Disposition',
            `attachment; filename=WhatsApp Chat With Contact +${phoneNumber}.zip`,
        );
        res.set('Content-Length', zipContent.length.toString());
        res.send(zipContent);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// WhatsApp Group helpers for front-end routes
export const getGroups: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        const session = getInstance(sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const groups = await session.groupFetchAllParticipating();
        const results: any[] = [];

        for (const [groupId, groupInfo] of Object.entries(groups)) {
            try {
                let fullId = groupId;
                if (typeof (session as any).groupMetadata === 'function') {
                    const metadata = await (session as any).groupMetadata(groupId);
                    if (metadata?.id) fullId = metadata.id;
                }

                results.push({
                    id: fullId,
                    name: (groupInfo as any).subject || 'Unnamed Group',
                    participants: (groupInfo as any).participants?.length || 0,
                });
            } catch (err) {
                results.push({
                    id: groupId,
                    name: (groupInfo as any).subject || 'Unnamed Group',
                    participants: (groupInfo as any).participants?.length || 0,
                });
            }
        }

        return res.status(200).json({
            results,
            note: 'Both full ID (with hyphen) and short ID (without hyphen) can be used to send messages',
        });
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getGroupsWithFullId: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        const session = getInstance(sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const groups = await session.groupFetchAllParticipating();
        const results: any[] = [];

        for (const [groupId, groupInfo] of Object.entries(groups)) {
            try {
                let fullId: string = groupId;
                let metadata: any = null;
                try {
                    if (typeof (session as any).groupMetadata === 'function') {
                        metadata = await (session as any).groupMetadata(groupId);
                        if (metadata?.id) fullId = metadata.id;
                    }
                } catch (err) {
                    logger.warn(`Could not fetch metadata for ${groupId}`, err);
                }

                results.push({
                    id: fullId,
                    shortId: groupId,
                    name: (groupInfo as any).subject || 'Unnamed Group',
                    description: (groupInfo as any).desc || '',
                    owner: (groupInfo as any).owner || '',
                    participants: (groupInfo as any).participants?.length || 0,
                    createdAt: (groupInfo as any).creation
                        ? new Date((groupInfo as any).creation * 1000)
                        : null,
                    idFormat: fullId.includes('-') ? 'full' : 'short',
                });
            } catch (err) {
                logger.warn(`Error processing group ${groupId}:`, err);
                results.push({
                    id: groupId,
                    shortId: groupId,
                    name: (groupInfo as any).subject || 'Unnamed Group',
                    description: (groupInfo as any).desc || '',
                    owner: (groupInfo as any).owner || '',
                    participants: (groupInfo as any).participants?.length || 0,
                    createdAt: (groupInfo as any).creation
                        ? new Date((groupInfo as any).creation * 1000)
                        : null,
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
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const searchGroups: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        const { query } = req.query as { query?: string };

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }
        if (!query || typeof query !== 'string') {
            return res.status(400).json({ message: 'Search query is required' });
        }

        const session = getInstance(sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const groups = await session.groupFetchAllParticipating();
        const searchTerm = query.toLowerCase();

        const results = Object.entries(groups)
            .filter(([_, groupInfo]: any) =>
                (groupInfo.subject || '').toLowerCase().includes(searchTerm),
            )
            .map(([groupId, groupInfo]: any) => ({
                id: groupId,
                name: groupInfo.subject || 'Unnamed Group',
                description: groupInfo.desc || '',
                participants: groupInfo.participants?.length || 0,
            }));

        return res.status(200).json({ query, totalFound: results.length, results });
    } catch (error) {
        logger.error(error);
        return res.status(500).json({ message: 'Internal server error' });
    }
};

export const getGroupById: RequestHandler = async (req, res) => {
    try {
        const { sessionId, groupId } = req.params as { sessionId: string; groupId: string };

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }
        if (!groupId) {
            return res.status(400).json({ message: 'Group ID is required' });
        }

        const session = getInstance(sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const normalizedGroupId = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;
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
};

export const getGroupMembers: RequestHandler = async (req, res) => {
    try {
        const { sessionId, groupId } = req.params as { sessionId: string; groupId: string };

        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }
        if (!groupId) {
            return res.status(400).json({ message: 'Group ID is required' });
        }

        const session = getInstance(sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const normalizedGroupId = groupId.includes('@g.us') ? groupId : `${groupId}@g.us`;
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
};

export const exportGroupsToCSV: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
        if (!isUUID(sessionId)) {
            return res.status(400).json({ message: 'Invalid or missing sessionId' });
        }

        const session = getInstance(sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }

        const groups = await session.groupFetchAllParticipating();

        let csvContent = 'Group ID,Group Name,Participants Count,Description\n';
        Object.entries(groups).forEach(([groupId, groupInfo]: any) => {
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
};

export const getMessengerList: RequestHandler = async (req, res) => {
    try {
        const { sessionId } = req.params;
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

export const getStatusOutgoingMessagesById: RequestHandler = async (req, res) => {
    try {
        const { sessionId, messageId } = req.params;
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

export const deleteMessagesForEveryone: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const results: { index: number; result?: any }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [index, { recipient, deleteMessageKey }] of req.body.entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, 'number');

                if (deleteMessageKey && deleteMessageKey.id) {
                    // Handle message deletion based on id
                    const key = {
                        remoteJid: jid,
                        id: deleteMessageKey.id,
                        fromMe: true, // assuming it's from the sender's perspective
                    };

                    const deleteMessageResult = await session.sendMessage(jid, { delete: key });
                    results.push({ index, result: deleteMessageResult });
                    await prisma.outgoingMessage.deleteMany({
                        where: { sessionId: req.params.sessionId, id: deleteMessageKey.id },
                    });
                } else {
                    throw new Error('deleteMessageKey with id is required to delete a message');
                }
            } catch (e) {
                const errorMessage =
                    e instanceof Error ? e.message : 'An error occurred during message delete';
                logger.error(e, errorMessage);
                errors.push({ index, error: errorMessage });
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

export const deleteMessagesForMe: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const results: { index: number; result?: any }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [index, { recipient, deleteMessageKey }] of req.body.entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, 'number');

                if (deleteMessageKey && deleteMessageKey.id) {
                    const key = {
                        id: deleteMessageKey.id,
                        fromMe: true,
                        timestamp: new Date().getTime(),
                    };

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
                const errorMessage =
                    e instanceof Error ? e.message : 'An error occurred during message delete';
                logger.error(e, errorMessage);
                errors.push({ index, error: errorMessage });
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
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const results: { index: number; result?: any }[] = [];
        const errors: { index: number; error: string }[] = [];

        for (const [index, { recipient, messageId, newText }] of req.body.entries()) {
            try {
                const jid = getJid(recipient);
                await verifyJid(session, jid, 'number');

                if (messageId) {
                    const key = {
                        remoteJid: jid,
                        id: messageId,
                        fromMe: true, // assuming it's from the sender's perspective
                    };

                    const updateMessageResult = await session.sendMessage(jid, {
                        text: newText,
                        edit: key,
                    });

                    results.push({ index, result: updateMessageResult });
                    await prisma.outgoingMessage.update({
                        where: { sessionId: req.params.sessionId, id: messageId },
                        data: { message: newText },
                    });
                } else {
                    throw new Error('messageId is required to update a message');
                }
            } catch (e) {
                const errorMessage =
                    e instanceof Error ? e.message : 'An error occurred during message update';
                logger.error(e, errorMessage);
                errors.push({ index, error: errorMessage });
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
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { recipient, duration } = req.body;

        if (!recipient || duration === undefined) {
            return res.status(400).json({ message: 'Recipient and duration are required' });
        }

        const jid = getJid(recipient);
        await verifyJid(session, jid, 'number');

        // Calculate mute duration in milliseconds
        const muteDuration = duration === null ? null : duration * 60 * 60 * 1000;

        // Perform chat modification to mute or unmute the chat
        await session.chatModify({ mute: muteDuration }, jid);

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
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { recipient, pin } = req.body;

        if (!recipient || pin === undefined) {
            return res.status(400).json({ message: 'Recipient and pin status are required' });
        }

        const jid = getJid(recipient);
        await verifyJid(session, jid, 'number');

        // Perform chat modification to pin or unpin the chat
        await session.chatModify({ pin }, jid);

        res.status(200).json({ message: `Chat ${pin ? 'pinned' : 'unpinned'}` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const starMessage: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { recipient, messageId, star } = req.body;

        if (!recipient || !messageId || star === undefined) {
            return res
                .status(400)
                .json({ message: 'Recipient, messageId, and star status are required' });
        }

        const jid = getJid(recipient);
        // Assuming verifyJid is not necessary for the 'star' operation

        // Construct the message key
        const key = {
            id: messageId,
            fromMe: true, // assuming the message is from the sender's perspective
        };

        // Perform chat modification to star or unstar the message
        const modifyParams = {
            star: {
                messages: [key],
                star, // `star` should be either `true` to star or `false` to unstar
            },
        };

        await session.chatModify(modifyParams, jid);

        res.status(200).json({ message: `Message ${star ? 'starred' : 'unstarred'}` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateProfileStatus: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { status } = req.body;

        if (!status) {
            return res.status(400).json({ message: 'Status is required' });
        }

        // Update profile status
        await session.updateProfileStatus(status);

        res.status(200).json({ message: 'Profile status updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateProfileName: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { name } = req.body;

        if (!name) {
            return res.status(400).json({ message: 'Name is required' });
        }

        // Update profile name
        await session.updateProfileName(name);

        res.status(200).json({ message: 'Profile name updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getProfilePictureUrl: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { recipient, resolution } = req.query as { recipient: string; resolution: string };
        if (!recipient) {
            return res.status(400).json({ message: 'Recipient is required' });
        }

        const jid = getJid(recipient);
        await verifyJid(session, jid, 'number');

        // Get profile picture URL
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

export const updateProfilePicture: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { jid, imageUrl } = req.body;

        if (!jid || !imageUrl) {
            return res.status(400).json({ message: 'jid and imageUrl are required' });
        }

        // Update profile picture
        await session.updateProfilePicture(jid, { url: imageUrl });

        res.status(200).json({ message: 'Profile picture updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const removeProfilePicture: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { myNumber } = req.body;

        if (!myNumber) {
            return res.status(400).json({ message: 'myNumber is required' });
        }

        const jid = getJid(myNumber);
        await verifyJid(session, jid, 'number');
        // Remove profile picture
        await session.removeProfilePicture(jid);

        res.status(200).json({ message: 'Profile picture removed successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateBlockStatus: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { contactId, action } = req.body;

        if (!contactId || !action) {
            return res.status(400).json({ message: 'contactId and action are required' });
        }

        if (action !== 'block' && action !== 'unblock') {
            return res.status(400).json({ message: 'action must be "block" or "unblock"' });
        }

        // Update block status
        await session.updateBlockStatus(contactId, action);

        res.status(200).json({ message: `User ${action}ed successfully` });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getBusinessProfile: RequestHandler = async (req, res) => {
    try {
        const session = getInstance(req.params.sessionId);
        if (!session) {
            return res.status(404).json({ message: 'Session not found' });
        }
        if (!isUUID(req.params.sessionId)) {
            return res.status(400).json({ message: 'Invalid sessionId' });
        }

        const { contactId } = req.query as { contactId: string };

        if (!contactId) {
            return res.status(400).json({ message: 'contactId query parameter is required' });
        }

        // Get business profile
        const profile = await session.getBusinessProfile(contactId);

        if (!profile) {
            return res.status(404).json({ message: 'Business profile not found' });
        }

        res.status(200).json({
            description: profile.description,
            category: profile.category,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
