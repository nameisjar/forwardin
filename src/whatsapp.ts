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
import { Store } from './store';
import { getSocketIO } from './socket';
import { Server } from 'socket.io';
import fs from 'fs';
import { WhatsAppGroupService } from './services/whatsappGroup';

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

            // Clear WhatsApp groups saat destroy session
            try {
                await WhatsAppGroupService.clearWhatsAppGroups(deviceId, sessionId);
                logger.info({ sessionId, deviceId }, 'WhatsApp groups cleared on session destroy');
            } catch (groupError) {
                logger.error(
                    { error: groupError, sessionId, deviceId },
                    'Failed to clear WhatsApp groups on destroy'
                );
            }

            await Promise.all([
                // Logout dengan error handling untuk koneksi yang sudah terputus
                logout && sock.logout().catch((err) => {
                    // Ignore "Connection Closed" error karena memang expected saat destroy
                    if (err?.message !== 'Connection Closed') {
                        logger.error({ error: err, sessionId }, 'Error during logout');
                    }
                }),

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

                // Delete media folder dengan proper error handling untuk ENOENT
                new Promise<void>((resolve) => {
                    fs.rm(subDirectoryPath, { recursive: true }, (err) => {
                        if (err) {
                            // Hanya log error jika bukan ENOENT (file not found)
                            if (err.code !== 'ENOENT') {
                                logger.error({ error: err, path: subDirectoryPath }, 'Error deleting media directory');
                            } else {
                                logger.debug({ path: subDirectoryPath }, 'Media directory does not exist, skipping deletion');
                            }
                        } else {
                            logger.info({ path: subDirectoryPath }, 'Media directory deleted successfully');
                        }
                        resolve();
                    });
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
                // console.log('\nScan QR untuk sesi:', sessionId, '\n');
                // console.log(ascii);
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

            // Auto-sync WhatsApp groups saat koneksi berhasil
            try {
                logger.info({ sessionId, deviceId }, 'Fetching WhatsApp groups...');
                const groups = await sock.groupFetchAllParticipating();
                const groupsArray = Object.values(groups).map((group: any) => ({
                    id: group.id,
                    subject: group.subject,
                    name: group.subject,
                    participants: group.participants || [],
                }));

                if (groupsArray.length > 0) {
                    // ✅ replaceAll = true karena ini adalah FULL SYNC saat koneksi pertama kali
                    await WhatsAppGroupService.saveWhatsAppGroups(
                        deviceId,
                        sessionId,
                        groupsArray,
                        true // Replace all existing groups
                    );
                    logger.info(
                        { sessionId, deviceId, count: groupsArray.length },
                        'WhatsApp groups synced successfully'
                    );
                } else {
                    logger.info({ sessionId, deviceId }, 'No WhatsApp groups found');
                }
            } catch (error) {
                logger.error(
                    { error, sessionId, deviceId },
                    'Failed to sync WhatsApp groups'
                );
            }
        }
        
        // Clear WhatsApp groups saat koneksi terputus
        if (connection === 'close') {
            try {
                await WhatsAppGroupService.clearWhatsAppGroups(deviceId, sessionId);
                logger.info({ sessionId, deviceId }, 'WhatsApp groups cleared on connection close');
            } catch (error) {
                logger.error(
                    { error, sessionId, deviceId },
                    'Failed to clear WhatsApp groups on connection close'
                );
            }
            handleConnectionClose();
        }
        
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

    // 🆕 Listen untuk grup baru yang di-join
    sock.ev.on('groups.upsert', async (groups) => {
        try {
            logger.info({ sessionId, deviceId, count: groups.length }, 'New groups joined detected');
            
            for (const group of groups) {
                try {
                    // Fetch group metadata untuk mendapatkan info lengkap
                    const groupMetadata = await sock.groupMetadata(group.id);
                    
                    const groupData = {
                        id: group.id,
                        subject: groupMetadata.subject || group.subject,
                        participants: groupMetadata.participants || [],
                    };

                    // Save grup baru ke database
                    await WhatsAppGroupService.saveWhatsAppGroups(
                        deviceId,
                        sessionId,
                        [groupData]
                    );
                    
                    logger.info(
                        { sessionId, deviceId, groupId: group.id, groupName: groupData.subject },
                        'New group saved to database'
                    );

                    // 🆕 Emit Socket.IO event ke frontend
                    const io: Server = getSocketIO();
                    const device = await prisma.device.findUnique({
                        where: { pkId: deviceId }
                    });
                    
                    if (device) {
                        // Emit event untuk grup spesifik yang baru join
                        io.emit(`device:${device.id}:group-joined`, {
                            groupId: group.id,
                            groupName: groupData.subject,
                            participants: groupMetadata.participants?.length || 0,
                            isActive: true,
                            sessionId: sessionId,
                        });
                        
                        // Emit event umum bahwa ada update di daftar grup
                        io.emit(`device:${device.id}:groups-updated`, {
                            action: 'group-joined',
                            groupId: group.id,
                            timestamp: new Date().toISOString(),
                        });
                        
                        logger.info(
                            { deviceId: device.id, groupId: group.id },
                            'Socket.IO events emitted for new group'
                        );
                    }
                } catch (groupError) {
                    logger.error(
                        { error: groupError, sessionId, deviceId, groupId: group.id },
                        'Failed to process new group'
                    );
                }
            }
        } catch (error) {
            logger.error(
                { error, sessionId, deviceId },
                'Failed to handle groups.upsert event'
            );
        }
    });

    // 🆕 Listen untuk update grup (nama berubah, participant berubah, dll)
    sock.ev.on('groups.update', async (updates) => {
        try {
            logger.info({ sessionId, deviceId, count: updates.length }, 'Group updates detected');
            
            for (const update of updates) {
                try {
                    // Skip jika tidak ada ID
                    if (!update.id) continue;
                    
                    // Fetch latest group metadata
                    const groupMetadata = await sock.groupMetadata(update.id);
                    
                    // Update di database
                    await prisma.whatsAppGroup.updateMany({
                        where: {
                            groupId: update.id,
                            deviceId: deviceId,
                        },
                        data: {
                            groupName: groupMetadata.subject,
                            participants: groupMetadata.participants?.length || 0,
                            updatedAt: new Date(),
                        },
                    });
                    
                    logger.info(
                        { sessionId, deviceId, groupId: update.id },
                        'Group updated in database'
                    );

                    // Emit Socket.IO event
                    const io: Server = getSocketIO();
                    const device = await prisma.device.findUnique({
                        where: { pkId: deviceId }
                    });
                    
                    if (device) {
                        io.emit(`device:${device.id}:groups-updated`, {
                            action: 'group-updated',
                            groupId: update.id,
                            timestamp: new Date().toISOString(),
                        });
                    }
                } catch (updateError) {
                    logger.error(
                        { error: updateError, sessionId, deviceId, groupId: update.id },
                        'Failed to process group update'
                    );
                }
            }
        } catch (error) {
            logger.error(
                { error, sessionId, deviceId },
                'Failed to handle groups.update event'
            );
        }
    });

    // 🆕 Listen untuk participant changes (termasuk ketika device keluar/dikick dari grup)
    sock.ev.on('group-participants.update', async (update) => {
        try {
            const { id: groupId, participants, action } = update;
            const myNumber = sock.user?.id.split(':')[0] + '@s.whatsapp.net';
            
            logger.info(
                { sessionId, deviceId, groupId, action, participantsCount: participants.length },
                'Group participants update detected'
            );
            
            // Check apakah device sendiri yang keluar/dikick dari grup
            // participants adalah array of strings (JID)
            const participantIds = participants.map((p: any) => typeof p === 'string' ? p : p.id);
            const isDeviceAffected = participantIds.includes(myNumber);
            
            if (isDeviceAffected && action === 'remove') {
                logger.info(
                    { sessionId, deviceId, groupId, action },
                    'Device left/removed from group'
                );
                
                // Update status grup menjadi tidak aktif di database
                await WhatsAppGroupService.updateGroupStatus(groupId, deviceId, false);
                
                logger.info(
                    { sessionId, deviceId, groupId },
                    'Group marked as inactive in database'
                );

                // Emit Socket.IO event ke frontend
                const io: Server = getSocketIO();
                const device = await prisma.device.findUnique({
                    where: { pkId: deviceId }
                });
                
                if (device) {
                    io.emit(`device:${device.id}:group-left`, {
                        groupId: groupId,
                        action: action,
                        timestamp: new Date().toISOString(),
                    });
                    
                    io.emit(`device:${device.id}:groups-updated`, {
                        action: 'group-left',
                        groupId: groupId,
                        timestamp: new Date().toISOString(),
                    });
                    
                    logger.info(
                        { deviceId: device.id, groupId },
                        'Socket.IO events emitted for group leave'
                    );
                }
            } else if (action === 'add' || action === 'promote' || action === 'demote' || action === 'remove') {
                // Update jumlah participants untuk perubahan lainnya
                try {
                    const groupMetadata = await sock.groupMetadata(groupId);
                    await prisma.whatsAppGroup.updateMany({
                        where: {
                            groupId: groupId,
                            deviceId: deviceId,
                        },
                        data: {
                            participants: groupMetadata.participants?.length || 0,
                            updatedAt: new Date(),
                        },
                    });
                    
                    // Emit update event
                    const io: Server = getSocketIO();
                    const device = await prisma.device.findUnique({
                        where: { pkId: deviceId }
                    });
                    
                    if (device) {
                        io.emit(`device:${device.id}:groups-updated`, {
                            action: 'participants-updated',
                            groupId: groupId,
                            timestamp: new Date().toISOString(),
                        });
                    }
                } catch (metadataError) {
                    logger.error(
                        { error: metadataError, sessionId, deviceId, groupId },
                        'Failed to update group metadata after participant change'
                    );
                }
            }
        } catch (error) {
            logger.error(
                { error, sessionId, deviceId },
                'Failed to handle group-participants.update event'
            );
        }
    });

    // 🆕 Listen untuk chats.update - mendeteksi ketika keluar dari grup
    sock.ev.on('chats.update', async (chats) => {
        try {
            for (const chat of chats) {
                // Check jika ini adalah grup chat yang berubah
                if (chat.id && chat.id.endsWith('@g.us')) {
                    const groupId = chat.id;
                    
                    // Log semua perubahan untuk debugging
                    logger.info(
                        { sessionId, deviceId, groupId, chatUpdate: chat },
                        'Chat update detected for group'
                    );
                    
                    // Jika ada property yang menandakan kita keluar dari grup
                    // Baileys bisa memberikan berbagai property seperti:
                    // - participant (array kosong jika kita keluar)
                    // - readOnly: true
                    // - ephemeralExpiration, dll
                    
                    // Coba fetch metadata untuk validasi apakah kita masih member
                    try {
                        await sock.groupMetadata(groupId);
                        // Jika berhasil, kita masih member, tidak perlu action
                    } catch (metadataError: any) {
                        // Jika gagal fetch metadata, kemungkinan kita sudah tidak di grup
                        if (metadataError?.output?.statusCode === 404 || 
                            metadataError?.message?.includes('not-authorized') ||
                            metadataError?.message?.includes('forbidden')) {
                            
                            logger.info(
                                { sessionId, deviceId, groupId },
                                'Device no longer in group (detected via chats.update)'
                            );
                            
                            // Update status grup menjadi tidak aktif di database
                            await WhatsAppGroupService.updateGroupStatus(groupId, deviceId, false);
                            
                            // Emit Socket.IO event ke frontend
                            const io: Server = getSocketIO();
                            const device = await prisma.device.findUnique({
                                where: { pkId: deviceId }
                            });
                            
                            if (device) {
                                io.emit(`device:${device.id}:group-left`, {
                                    groupId: groupId,
                                    action: 'leave',
                                    timestamp: new Date().toISOString(),
                                });
                                
                                io.emit(`device:${device.id}:groups-updated`, {
                                    action: 'group-left',
                                    groupId: groupId,
                                    timestamp: new Date().toISOString(),
                                });
                                
                                logger.info(
                                    { deviceId: device.id, groupId },
                                    'Socket.IO events emitted for group leave (chats.update)'
                                );
                            }
                        }
                    }
                }
            }
        } catch (error) {
            logger.error(
                { error, sessionId, deviceId },
                'Failed to handle chats.update event'
            );
        }
    });

    // Debug events
    // sock.ev.on('messaging-history.set', (data) => dump('messaging-history.set', data));
    // sock.ev.on('chats.upsert', (data) => dump('chats.upsert', data));
    // sock.ev.on('contacts.update', (data) => dump('contacts.update', data));

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
