import makeWASocket, {
    Browsers,
    ConnectionState,
    DisconnectReason,
    SocketConfig,
    WASocket,
    makeCacheableSignalKeyStore,
} from '@whiskeysockets/baileys';
import prisma from './utils/db';
import { toDataURL } from 'qrcode';
import logger from './config/logger';
import type { Response } from 'express';
import { Boom } from '@hapi/boom';
import { delay } from './utils/delay';
import { useSession } from './utils/useSession';

type Session = WASocket & {
    destroy: () => Promise<void>;
};

const sessions = new Map<string, Session>();
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
        createSession({ sessionId, deviceId, readIncomingMessages, socketConfig });
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

type createSessionOptions = {
    sessionId: string;
    deviceId: number;
    res?: Response;
    SSE?: boolean;
    readIncomingMessages?: boolean;
    socketConfig?: SocketConfig;
};

export async function createSession(options: createSessionOptions) {
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

    const destroy = async (logout = true) => {
        try {
            await Promise.all([
                logout && sock.logout(),
                // prisma.chat.deleteMany({ where: { sessionId } }),
                // prisma.contact.deleteMany({ where: { sessionId } }),
                // prisma.message.deleteMany({ where: { sessionId } }),
                // prisma.groupMetadata.deleteMany({ where: { sessionId } }),
                prisma.session.deleteMany({ where: { sessionId } }),
            ]);
        } catch (e) {
            logger.error(e, 'An error occured during session destroy');
        } finally {
            sessions.delete(sessionId);
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
        setTimeout(() => createSession(options), restartRequired ? 0 : RECONNECT_INTERVAL);
    };

    const handleNormalConnectionUpdate = async () => {
        if (connectionState.qr?.length) {
            if (res && !res.headersSent) {
                try {
                    const qr = await toDataURL(connectionState.qr);
                    res.status(200).json({ qr });
                    return;
                } catch (e) {
                    logger.error(e, 'An error occured during QR generation');
                    res.status(500).json({ error: 'Unable to generate QR' });
                }
            }
            destroy();
        }
    };

    const handleSSEConnectionUpdate = async () => {
        let qr: string | undefined = undefined;
        if (connectionState.qr?.length) {
            try {
                qr = await toDataURL(connectionState.qr);
            } catch (e) {
                logger.error(e, 'An error occured during QR generation');
            }
        }

        const currentGenerations = SSEQRGenerations.get(sessionId) ?? 0;
        if (!res || res.writableEnded || (qr && currentGenerations >= SSE_MAX_QR_GENERATION)) {
            res && !res.writableEnded && res.end();
            destroy();
            return;
        }

        const data = { ...connectionState, qr };
        if (qr) SSEQRGenerations.set(sessionId, currentGenerations + 1);
        res.write(`data: ${JSON.stringify(data)}\n\n`);
    };

    const handleConnectionUpdate = SSE ? handleSSEConnectionUpdate : handleNormalConnectionUpdate;

    const { state, saveCreds } = await useSession(sessionId, deviceId);
    const sock = makeWASocket({
        printQRInTerminal: true,
        browser: Browsers.ubuntu('Chrome'),
        ...socketConfig,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger),
        },
        logger,
    });

    sock.ev.on('creds.update', saveCreds);
    sock.ev.on('connection.update', (update) => {
        connectionState = update;
        const { connection } = update;

        if (connection === 'open') {
            retries.delete(sessionId);
            SSEQRGenerations.delete(sessionId);
        }
        if (connection === 'close') handleConnectionClose();
        handleConnectionUpdate();
    });

    if (readIncomingMessages) {
        sock.ev.on('messages.upsert', async (m) => {
            const message = m.messages[0];
            if (message.key.fromMe || m.type !== 'notify') return;

            await delay(1000);
            await sock.readMessages([message.key]);
        });
    }

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

export async function deleteSession(sessionId: string) {
    sessions.get(sessionId)?.destroy();
}
