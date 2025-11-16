/* eslint-disable @typescript-eslint/no-explicit-any */
import makeWASocket, {
    ConnectionState,
    DisconnectReason,
    SocketConfig,
    WASocket,
    makeCacheableSignalKeyStore,
    proto,
} from '@whiskeysockets/baileys';
import prisma from './utils/db';
import { toDataURL, toString as qrToString } from 'qrcode';
import logger from './config/logger';
import { WebSocket } from 'ws';
import type { Response } from 'express';
import { Boom } from '@hapi/boom';
import { delay } from './utils/delay';
import { useSession } from './utils/useSession';
// import { writeFile } from 'fs/promises';
// import { join } from 'path';
import { Store } from './store';
import { processButton } from './utils/processBtn';
import { getSocketIO } from './socket';
import { Server } from 'socket.io';
import fs from 'fs';
import { connect } from 'http2';
import { de } from 'date-fns/locale';

type Instance = WASocket & {
    destroy: () => Promise<void>;
    store: Store;
};

const instances = new Map<string, Instance>();
const retries = new Map<string, number>();
const SSEQRGenerations = new Map<string, number>();

const RECONNECT_INTERVAL = Number(process.env.RECONNECT_INTERVAL || 0);
const MAX_RECONNECT_RETRIES = Number(process.env.MAX_RECONNECT_RETRIES || 5);
const SSE_MAX_QR_GENERATION = Number(process.env.SSE_MAX_QR_GENERATION || 5);
const SESSION_CONFIG_ID = 'session-config';

export async function init() {
    const sessions = await prisma.session.findMany({
        select: { sessionId: true, deviceId: true, data: true },
        where: { id: { startsWith: SESSION_CONFIG_ID } },
    });

    for (const { sessionId, deviceId, data } of sessions) {
        const { readIncomingMessages, ...socketConfig } = JSON.parse(data);
        createInstance({ sessionId, deviceId, readIncomingMessages, socketConfig });
    }
}

function shouldReconnect(sessionId: string) {
    let attempts = retries.get(sessionId) ?? 0;

    if (attempts < MAX_RECONNECT_RETRIES) {
        attempts += 1;
        retries.set(sessionId, attempts);
        return true;
    }
    return false;
}

type createInstanceOptions = {
    sessionId: string;
    deviceId: number;
    res?: Response;
    SSE?: boolean;
    readIncomingMessages?: boolean;
    socketConfig?: SocketConfig;
};

export async function createInstance(options: createInstanceOptions) {
    const {
        sessionId,
        deviceId,
        res,
        SSE = false,
        readIncomingMessages = false,
        socketConfig,
    } = options;
    const configID = `${SESSION_CONFIG_ID}-${sessionId}`;
    let connectionState: Partial<ConnectionState> = { connection: 'close' };

    // back here: delete temporary folders
    const destroy = async (logout = true) => {
        try {
            const subDirectoryPath = `media/S${sessionId}`;

            await Promise.all([
                logout && sock.logout(),

                // prisma.chat.deleteMany({ where: { sessionId } }),
                // prisma.groupMetadata.deleteMany({ where: { sessionId } }),

                // prisma.contact.deleteMany({
                //     where: {
                //         contactDevices: { some: { device: { sessions: { some: { sessionId } } } } },
                //     },
                // }),

                prisma.message.updateMany({ where: { sessionId }, data: { sessionId: null } }),
                prisma.incomingMessage.updateMany({
                    where: { sessionId },
                    data: {
                        sessionId: null,
                    },
                }),
                prisma.outgoingMessage.updateMany({
                    where: { sessionId },
                    data: {
                        sessionId: null,
                    },
                }),
                prisma.session.deleteMany({ where: { sessionId } }),

                fs.rm(subDirectoryPath, { recursive: true }, (err) => {
                    if (err) {
                        console.error(`Error deleting sub-directory: ${err}`);
                    } else {
                        console.log(`Sub-directory ${subDirectoryPath} is deleted successfully.`);
                    }
                }),
            ]);
        } catch (e) {
            logger.error(e, 'An error occured during session destroy');
        } finally {
            instances.delete(sessionId);
        }
    };

    const handleConnectionClose = () => {
        const code = (connectionState.lastDisconnect?.error as Boom)?.output?.statusCode;
        const restartRequired = code === DisconnectReason.restartRequired;
        const doNotReconnect = !shouldReconnect(sessionId);

        if (code === DisconnectReason.loggedOut || doNotReconnect) {
            if (res) {
                !SSE &&
                    !res.headersSent &&
                    res.status(500).json({ error: 'Unable to create session' });
                res.end();
            }
            destroy(doNotReconnect);
            return;
        }

        if (!restartRequired) {
            logger.info({ attempts: retries.get(sessionId) ?? 1, sessionId }, 'Reconnecting...');
        }
        setTimeout(() => createInstance(options), restartRequired ? 0 : RECONNECT_INTERVAL);
    };

    const handleNormalConnectionUpdate = async () => {
        if (connectionState.qr?.length) {
            if (res && !res.headersSent) {
                try {
                    const qr = await toDataURL(connectionState.qr);
                    res.status(200).json({ qr, sessionId });
                    return;
                } catch (e) {
                    logger.error(e, 'An error occured during QR generation');
                    res.status(500).json({ error: 'Unable to generate QR' });
                    res.end();
                }
            }
            // Don't destroy the session immediately, let it continue for potential reconnection
            return;
        }

        // Only destroy if connection is closed and not generating QR
        if (connectionState.connection === 'close') {
            destroy();
        }
    };

    const handleSSEConnectionUpdate = async () => {
        let qr: string | undefined = undefined;
        let qrAscii: string | undefined = undefined;

        if (connectionState.qr?.length) {
            try {
                qr = await toDataURL(connectionState.qr);
                try {
                    qrAscii = await qrToString(connectionState.qr, {
                        type: 'terminal',
                        small: true,
                    });
                } catch (e) {
                    logger.error(e, 'An error occured during QR ASCII generation');
                }
            } catch (e) {
                logger.error(e, 'An error occured during QR generation');
                // Continue even if QR generation fails
            }
        }

        const currentGenerations = SSEQRGenerations.get(sessionId) ?? 0;
        const maxGenerations = Math.max(1, SSE_MAX_QR_GENERATION);

        // Check if response is still writable
        if (!res || res.writableEnded) {
            destroy();
            return;
        }

        // If we have QR and reached max generations, end gracefully
        if (qr && currentGenerations >= maxGenerations) {
            const data = { ...connectionState, qr, qrRaw: qrAscii, maxGenerationsReached: true };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.end();
                }
                destroy();
            }, 1000); // Give time for the client to receive the final QR
            return;
        }

        const data = { ...connectionState, qr, qrRaw: qrAscii };
        if (qr) SSEQRGenerations.set(sessionId, currentGenerations + 1);

        try {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (e) {
            logger.error(e, 'Error writing SSE data');
            destroy();
            return;
        }

        // Don't end the connection immediately, let it continue for more QR updates or connection success
    };

    const handleConnectionUpdate = SSE ? handleSSEConnectionUpdate : handleNormalConnectionUpdate;

    const { state, saveCreds } = await useSession(sessionId, deviceId);
    // back here: adjust SocketConfig such as turn off always online
    const sock = makeWASocket({
        // printQRInTerminal removed due to deprecation; handled manually in connection.update
        browser: ['Autosender', 'Chrome', '10.0'],
        ...socketConfig,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger as any),
        },
        logger: logger as any,
        markOnlineOnConnect: false,

        getMessage: async (key) => {
            const data = await prisma.message.findFirst({
                where: { remoteJid: key.remoteJid!, id: key.id!, sessionId },
            });
            return (data?.message || undefined) as proto.IMessage | undefined;
        },
    });

    const store = new Store(sessionId, sock.ev);
    instances.set(sessionId, { ...sock, destroy, store });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', async (update) => {
        logger.debug(update);

        // Manually print QR to terminal when available (replacement for deprecated printQRInTerminal)
        if (update.qr && process.env.NODE_ENV !== 'production') {
            try {
                const ascii = await qrToString(update.qr, { type: 'terminal', small: true });
                // keep minimal, do not alter logic; just print
                console.log('\nScan QR untuk sesi:', sessionId, '\n');
                console.log(ascii);
            } catch (e) {
                logger.error(e, 'Error generating terminal QR');
            }
        }

        connectionState = update;
        const { connection } = update;

        if (connection === 'open') {
            retries.delete(sessionId);
            SSEQRGenerations.delete(sessionId);

            // ?back here: forbid duplicate phone numbers
            const phone = sock.user?.id.split(':')[0];

            await prisma.device.update({
                where: { pkId: deviceId },
                data: { phone, updatedAt: new Date() },
            });
        }
        if (connection === 'close') handleConnectionClose();
        handleConnectionUpdate();

        // back here: Record to update not found
        const device = await prisma.device.update({
            where: { pkId: deviceId },
            data: { status: connection, updatedAt: new Date() },
        });

        if (connection) {
            await prisma.deviceLog.create({
                data: {
                    sessionId,
                    deviceId,
                    status: connection,
                },
            });
        }

        const io: Server = getSocketIO();
        io.emit(`device:${device.id}:status`, connection);
    });

    if (readIncomingMessages) {
        sock.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0];
            if (!message.key || message.key.fromMe || m.type !== 'notify') return;

            await delay(1000);
            if (message.key) {
                await sock.readMessages([message.key]);
            }
        });
    }

    // Debug events
    // sock.ev.on('messaging-history.set', (data) => dump('messaging-history.set', data));
    // sock.ev.on('chats.upsert', (data) => dump('chats.upsert', data));
    // sock.ev.on('contacts.update', (data) => dump('contacts.update', data));
    // sock.ev.on('groups.upsert', (data) => dump('groups.upsert', data));

    await prisma.session.upsert({
        create: {
            id: configID,
            sessionId,
            data: JSON.stringify({ readIncomingMessages, ...socketConfig }),
            deviceId,
        },
        update: {},
        where: { sessionId_id: { id: configID, sessionId } },
    });
}

export function verifyInstance(sessionId: string) {
    return instances.has(sessionId);
}

export function getInstance(sessionId: string) {
    const session = instances.get(sessionId);
    if (!verifyInstance(sessionId)) {
        throw new Error(`Session with sessionId ${sessionId} not found.`);
    }
    return session;
}

export function getInstanceStatus(session: Instance) {
    const state = ['CONNECTING', 'CONNECTED', 'DISCONNECTING', 'DISCONNECTED'];
    let status = 'DISCONNECTED';

    // back here: fix ws
    if (session && session.ws instanceof WebSocket) {
        status = state[session.ws.readyState];
    }

    status = session && session.user ? 'AUTHENTICATED' : status;
    return status;
}

export async function deleteInstance(sessionId: string) {
    instances.get(sessionId)?.destroy();
}

export async function verifyJid(session: Instance, jid: string, type: string = 'number') {
    if (type != 'group') {
        if (jid.includes('@g.us')) return true;
        const onWAResult = await session.onWhatsApp(jid);
        const result = Array.isArray(onWAResult) ? onWAResult[0] : onWAResult;
        if (result && result.exists) return true;
        throw new Error(`No account exists for jid: ${jid}`);
    } else if (type === 'group') {
        const groupMeta = await session.groupMetadata(jid);
        if (groupMeta && groupMeta.id) return true;
        throw new Error('Error fetching group metadata');
    } else {
        throw new Error('Invalid message type specified');
    }
}

export function getJid(jid: string) {
    if (jid.includes('@g.us') || jid.includes('@s.whatsapp.net')) {
        return jid;
    }
    return jid.includes('-') ? `${jid}@g.us` : `${jid}@s.whatsapp.net`;
}

export async function sendMediaFile(
    session: Instance,
    recipients: string[],
    file: {
        mimetype?: any;
        buffer?: unknown;
        newName?: string | undefined;
        originalName?: string | undefined;
        url: string | undefined;
    },
    type: string,
    caption = '',
    data?: any,
    messageId?: any,
) {
    const results: { index: number; result?: any }[] = [];
    const errors: { index: number; error: string }[] = [];

    for (let index = 0; index < recipients.length; index++) {
        const recipient = recipients[index];
        try {
            await verifyJid(session, getJid(recipient), 'number');

            let message: any;

            if (type === 'video') {
                message = {
                    video: file.buffer,
                    caption: caption,
                    fileName: file.newName ?? file.originalName,
                };
            } else {
                message = {
                    mimetype: file.mimetype,
                    [type]: file.buffer ?? { url: file.url },
                    caption: caption,
                    fileName: file.newName ?? file.originalName,
                };
            }

            const result = await session.sendMessage(getJid(recipient), message, {
                quoted: data,
                messageId,
            });
            results.push({ index, result });
        } catch (error: unknown) {
            const message =
                error instanceof Error ? error.message : 'An error occurred during media send';
            logger.error(error, message);
            errors.push({ index, error: message });
        }
    }

    return { results, errors };
}

// back here: only show on wa web [deprecated: https://github.com/WhiskeySockets/Baileys/issues/56]
export async function sendButtonMessage(
    session: Instance,
    to: string,
    data: { buttons: any[]; text: any; footerText: any },
) {
    try {
        const recipientJid = getJid(to);
        await verifyJid(session, recipientJid);

        const result = await session.sendMessage(recipientJid, {
            text: data.text || '',
            footer: data.footerText || '',
        });

        return result;
    } catch (error) {
        logger.error('Error sending button message:', error);
        throw error;
    }
}

// to do: send list messages

// export async function dump(fileName: string, data: any) {
//     const path = join(__dirname, '..', 'debug', `${fileName}.json`);
//     await writeFile(path, JSON.stringify(data, null, 2));
// }
