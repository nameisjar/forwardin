/* eslint-disable @typescript-eslint/no-explicit-any */
import makeWASocket, {
    ConnectionState,
    DisconnectReason,
    SocketConfig,
    WASocket,
    makeCacheableSignalKeyStore,
    proto,
    fetchLatestBaileysVersion,
    S_WHATSAPP_NET,
} from '@whiskeysockets/baileys';
import { Prisma } from '@prisma/client';
import prisma from './utils/db';
import { toDataURL, toString as qrToString } from 'qrcode';
import logger from './config/logger';
import { WebSocket } from 'ws';
import type { Response } from 'express';
import { Boom } from '@hapi/boom';
import { delay } from './utils/delay';
import { useSession } from './utils/useSession';
import { Store } from './store';
import { emitDeviceStatusChange, getSocketIO } from './socket';
import { warmInboxProfileCache } from './services/inboxProfileCache';
import { createInboxProfileUrl } from './utils/inboxMedia';
import { Server } from 'socket.io';
import fs from 'fs';
import { WhatsAppGroupService } from './services/whatsappGroup';
import {
    getOrCreateSessionState,
    getSessionState,
    updateConnectionState,
    markConnectionSuccessful,
    markReconnecting,
    isConnectionSuccessful,
    isSessionConnected,
    getSessionQR,
    getLastDisconnect,
    removeSessionState,
} from './utils/sessionState';
import {
    DeviceConnectionStatus,
    getReconnectDelay,
    isRecoverableConnectionConflict,
    normalizeConnectionUpdate,
} from './utils/connectionPolicy';
import { SessionGenerationRegistry } from './utils/sessionGeneration';
import {
    recordConnectionError,
    recordReconnection,
} from './services/signalDetector';
import { shouldProcessHistorySync } from './utils/historySyncPolicy';
import {
    eligibleOutgoingMessageStatuses,
    outgoingMessageStatusLevel,
} from './utils/outgoingMessageStatus';
import {
    evaluateOutboundSendReadiness,
    OutboundSendReadiness,
} from './utils/outboundReadiness';
import {
    sendGenericMessage,
    type SendMessageOptions,
} from './services/messageSender';
import { extractMessageEdit } from './utils/messageEdit';
import { applyIncomingMessageEdit } from './services/incomingMessageEdit';
import { upsertMessageReadReceipt } from './services/messageReadReceipt';

export type SessionDestroyResult = {
    logoutAttempted: boolean;
    logoutSucceeded: boolean;
    failures: string[];
};

type Instance = WASocket & {
    destroy: (logout?: boolean, purgeAuth?: boolean) => Promise<SessionDestroyResult>;
    store: Store;
    deviceId: number;
    generation: number;
    getSendReadiness: (jid?: string) => OutboundSendReadiness;
};

const instances = new Map<string, Instance>();
const deviceSessionOwners = new Map<number, string>();
const instanceCreations = new Map<string, Promise<void>>();
const circuitOpenSessions = new Set<string>();
const retries = new Map<string, number>();
const reconnectTimers = new Map<string, NodeJS.Timeout>();
const socketGenerations = new SessionGenerationRegistry();
const conflictRecoveryAttempts = new Map<string, number>();
const SSEQRGenerations = new Map<string, number>();
const recipient463Cooldowns = new Map<string, Map<string, number>>();
const reachoutTimelockFetchTimestamps = new Map<string, number>();
const RECIPIENT_463_COOLDOWN_MS = Math.max(
    5_000,
    Number(process.env.WHATSAPP_463_RECIPIENT_COOLDOWN_MS || 60_000),
);
const REMOTE_LOGOUT_TIMEOUT_MS = Math.max(
    5_000,
    Number(process.env.WHATSAPP_LOGOUT_TIMEOUT_MS || 20_000),
);
const REACHOUT_TIMELOCK_REFRESH_MS = Math.max(
    5_000,
    Number(process.env.WHATSAPP_REACHOUT_REFRESH_MS || 30_000),
);
// 🆕 Track active SSE connections to prevent conflicts
const activeSSEConnections = new Map<number, { sessionId: string; aborted: boolean }>();
// 🆕 Track manual logout to prevent false positive signal recording
const manualLogoutInProgress = new Set<number>();

function normalizeRecipientCooldownKey(jid: string | null | undefined): string | null {
    const normalized = String(jid || '').trim().toLowerCase();
    return normalized || null;
}

function setRecipient463Cooldown(
    sessionId: string,
    jid: string | null | undefined,
): void {
    const key = normalizeRecipientCooldownKey(jid);
    if (!key) return;

    let cooldowns = recipient463Cooldowns.get(sessionId);
    if (!cooldowns) {
        cooldowns = new Map<string, number>();
        recipient463Cooldowns.set(sessionId, cooldowns);
    }
    cooldowns.set(key, Date.now() + RECIPIENT_463_COOLDOWN_MS);
}

function getRecipient463RetryAt(sessionId: string, jid: string | undefined): number | null {
    const key = normalizeRecipientCooldownKey(jid);
    if (!key) return null;

    const cooldowns = recipient463Cooldowns.get(sessionId);
    const retryAt = cooldowns?.get(key);
    if (!retryAt) return null;
    if (retryAt <= Date.now()) {
        cooldowns?.delete(key);
        if (cooldowns?.size === 0) recipient463Cooldowns.delete(sessionId);
        return null;
    }
    return retryAt;
}

function detachSocketListeners(socket: WASocket): void {
    try {
        (socket.ev as any).removeAllListeners?.();
    } catch (error) {
        logger.warn({ error }, 'Failed to detach listeners from retired WhatsApp socket');
    }
}

function closeSocketTransport(socket: WASocket): void {
    detachSocketListeners(socket);
    try {
        socket.ws.close();
    } catch {
        // The transport may already be fully closed.
    }
}

/**
 * Mark a device as undergoing manual logout (user-initiated)
 * This prevents false positive "forced_logout" signal recording
 */
export function markManualLogout(devicePkId: number): void {
    manualLogoutInProgress.add(devicePkId);
    logger.info({ devicePkId }, 'Device marked for manual logout - will skip signal recording');
}

/**
 * Clear manual logout flag after processing
 */
export function clearManualLogout(devicePkId: number): void {
    manualLogoutInProgress.delete(devicePkId);
}

/**
 * Check if device is undergoing manual logout
 */
export function isManualLogout(devicePkId: number): boolean {
    return manualLogoutInProgress.has(devicePkId);
}

const RECONNECT_INTERVAL = Number(process.env.RECONNECT_INTERVAL || 2000);
const RECONNECT_MAX_INTERVAL = Number(process.env.RECONNECT_MAX_INTERVAL || 60000);
const MAX_RECONNECT_RETRIES = Number(process.env.MAX_RECONNECT_RETRIES || 5);
const MAX_BACKGROUND_RECONNECT_RETRIES = Number(
    process.env.MAX_BACKGROUND_RECONNECT_RETRIES || 10,
);
const SSE_MAX_QR_GENERATION = Number(process.env.SSE_MAX_QR_GENERATION || 5);
const SESSION_CONFIG_ID = 'session-config';

async function publishDeviceConnectionStatus(
    deviceId: number,
    sessionId: string,
    status: DeviceConnectionStatus,
): Promise<void> {
    const device = await prisma.device.update({
        where: { pkId: deviceId },
        data: { status, updatedAt: new Date() },
    });

    try {
        await prisma.deviceLog.create({
            data: { sessionId, deviceId, status },
        });
    } catch (error) {
        // Status delivery is more important than its audit entry. A logging
        // failure must not leave connected clients with a stale indicator.
        logger.warn({ error, sessionId, deviceId, status }, 'Failed to record device status log');
    }

    const isConnected = status === 'open';
    getSocketIO()
        .to(`device:${device.id}`)
        .emit(`device:${device.id}:status`, status);
    emitDeviceStatusChange(device.id, status, isConnected);
}

export async function init() {
    const storedSessions = await prisma.session.findMany({
        select: { pkId: true, sessionId: true, deviceId: true, data: true },
        where: { id: { startsWith: SESSION_CONFIG_ID } },
        orderBy: { pkId: 'desc' },
    });

    const sessions = Array.from(
        new Map(storedSessions.map(session => [session.deviceId, session])).values(),
    );
    const selectedSessionIds = new Set(sessions.map(session => session.sessionId));
    const supersededSessionIds = Array.from(new Set(
        storedSessions
            .filter(session => !selectedSessionIds.has(session.sessionId))
            .map(session => session.sessionId),
    ));
    if (supersededSessionIds.length > 0) {
        await prisma.session.deleteMany({
            where: { sessionId: { in: supersededSessionIds } },
        });
        logger.warn(
            { supersededSessionIds },
            'Removed duplicate WhatsApp sessions before startup restore',
        );
    }

    const results = await Promise.allSettled(
        sessions.map(({ sessionId, deviceId, data }) => {
            const { readIncomingMessages, ...socketConfig } = JSON.parse(data);
            return createInstance({ sessionId, deviceId, readIncomingMessages, socketConfig });
        }),
    );

    results.forEach((result, index) => {
        if (result.status === 'rejected') {
            logger.error(
                { error: result.reason, sessionId: sessions[index]?.sessionId },
                'Failed to restore WhatsApp session during startup',
            );
        }
    });
}

// 🆕 Export helper function untuk akses activeSSEConnections Map
export function getActiveSSEConnections() {
    return activeSSEConnections;
}

function nextReconnectAttempt(sessionId: string): number {
    const attempts = (retries.get(sessionId) ?? 0) + 1;
    retries.set(sessionId, attempts);
    return attempts;
}

// 🆕 Helper untuk check apakah SSE sudah di-abort
function isSSEAborted(deviceId: number): boolean {
    const connection = activeSSEConnections.get(deviceId);
    return connection?.aborted || false;
}

// 🆕 Helper untuk mark SSE sebagai aborted
function markSSEAborted(deviceId: number, sessionId: string): void {
    const connection = activeSSEConnections.get(deviceId);
    if (connection?.sessionId !== sessionId) {
        logger.debug(
            { deviceId, sessionId, activeSessionId: connection?.sessionId },
            'Ignoring close event from a superseded SSE pairing request',
        );
        return;
    }
    if (connection) {
        connection.aborted = true;
        logger.info({ deviceId, sessionId: connection.sessionId }, 'SSE marked as aborted');
    }
}

type createInstanceOptions = {
    sessionId: string;
    deviceId: number;
    res?: Response;
    SSE?: boolean;
    readIncomingMessages?: boolean;
    socketConfig?: SocketConfig;
    replaceExisting?: boolean;
    sseCleanup?: () => void; // 🆕 Cleanup function untuk force close SSE
};

export function createInstance(options: createInstanceOptions): Promise<void> {
    const existingCreation = instanceCreations.get(options.sessionId);
    if (existingCreation) return existingCreation;

    const owner = deviceSessionOwners.get(options.deviceId);
    if (owner && owner !== options.sessionId) {
        return Promise.reject(
            new Error(`Device ${options.deviceId} already belongs to session ${owner}`),
        );
    }
    if (instances.has(options.sessionId) && !options.replaceExisting) {
        return Promise.resolve();
    }

    const generation = socketGenerations.begin(options.sessionId);
    deviceSessionOwners.set(options.deviceId, options.sessionId);
    if (!options.replaceExisting) circuitOpenSessions.delete(options.sessionId);

    const creation = (async () => {
        if (options.replaceExisting) {
            const previousInstance = instances.get(options.sessionId);
            if (previousInstance) {
                instances.delete(options.sessionId);
                closeSocketTransport(previousInstance);
                logger.info(
                    {
                        sessionId: options.sessionId,
                        deviceId: options.deviceId,
                        previousGeneration: previousInstance.generation,
                        generation,
                    },
                    'Retired previous WhatsApp transport before creating replacement',
                );
            }
        }

        await createInstanceInternal(options, generation);
    })().catch((error) => {
        if (!instances.has(options.sessionId)) {
            const currentOwner = deviceSessionOwners.get(options.deviceId);
            if (currentOwner === options.sessionId) {
                deviceSessionOwners.delete(options.deviceId);
            }
        }
        socketGenerations.clear(options.sessionId, generation);
        throw error;
    }).finally(() => {
        if (instanceCreations.get(options.sessionId) === creation) {
            instanceCreations.delete(options.sessionId);
        }
    });
    instanceCreations.set(options.sessionId, creation);
    return creation;
}

async function createInstanceInternal(
    options: createInstanceOptions,
    generation: number,
): Promise<void> {
    const {
        sessionId,
        deviceId,
        res,
        SSE = false,
        readIncomingMessages = false,
        socketConfig,
        sseCleanup,
    } = options;
    const configID = `${SESSION_CONFIG_ID}-${sessionId}`;

    await prisma.session.upsert({
        create: {
            id: configID,
            sessionId,
            data: JSON.stringify({ readIncomingMessages, ...socketConfig }),
            deviceId,
        },
        update: {
            data: JSON.stringify({ readIncomingMessages, ...socketConfig }),
            deviceId,
        },
        where: { sessionId_id: { id: configID, sessionId } },
    });
    
    // 🔧 FIX: Gunakan centralized state management (Issue 3.5)
    // State disimpan di Map global, bukan local variable yang di-capture closure
    const sessionState = getOrCreateSessionState(sessionId, deviceId);
    if (!sessionState.isReconnecting) {
        updateConnectionState(sessionId, { connection: 'connecting' });
    }
    
    // Helper untuk akses state terkini (selalu ambil dari Map, bukan closure)
    const getState = () => getSessionState(sessionId);
    const isActiveGeneration = () => socketGenerations.isCurrent(sessionId, generation);
    const getSendReadiness = (jid?: string): OutboundSendReadiness => {
        return evaluateOutboundSendReadiness({
            generationCurrent: isActiveGeneration(),
            sessionConnected: isSessionConnected(sessionId),
            authenticated: Boolean(sock?.user),
            socketOpen: Boolean(sock.ws.isOpen),
            reachoutLock: getState()?.connectionState.reachoutTimeLock,
            recipientRetryAt: getRecipient463RetryAt(sessionId, jid),
        });
    };

    // 🆕 Register SSE connection
    if (SSE && res) {
        activeSSEConnections.set(deviceId, { sessionId, aborted: false });
        logger.info({ deviceId, sessionId }, 'SSE connection registered');
    }

    // 🔧 REFACTORED: Helper functions untuk cleaner destroy logic (Issue 3.4)
    
    /**
     * Cleanup database records - nullify sessionId untuk messages
     */
    const cleanupDatabaseRecords = async (): Promise<{ success: boolean; errors: string[] }> => {
        const errors: string[] = [];
        
        const operations = [
            { name: 'Message', fn: () => prisma.message.updateMany({ where: { sessionId }, data: { sessionId: null } }) },
            // NOTE: IncomingMessage NOT nullified here - messages persist via deviceId for Inbox feature
            // OutgoingMessage keeps its historical sessionId and permanent deviceId
            // so Inbox history survives logout and QR relinking.
            { name: 'Session', fn: () => prisma.session.deleteMany({ where: { sessionId } }) },
        ];
        
        const results = await Promise.allSettled(operations.map(op => op.fn()));
        
        results.forEach((result, index) => {
            if (result.status === 'rejected') {
                const errorMsg = `${operations[index].name}: ${result.reason?.message || 'Unknown error'}`;
                errors.push(errorMsg);
                logger.error({ error: result.reason, operation: operations[index].name, sessionId }, 'Database cleanup failed');
            }
        });
        
        return { success: errors.length === 0, errors };
    };
    
    /**
     * Cleanup media files - delete session media directory
     */
    const cleanupMediaFiles = async (): Promise<{ success: boolean; error?: string }> => {
        const subDirectoryPath = `media/S${sessionId}`;

        // Inbox messages keep references to downloaded images/documents even
        // after a WhatsApp reconnect. Do not remove their media directory while
        // those persisted records still exist.
        const referencedMediaCount = await prisma.incomingMessage.count({
            where: {
                sessionId,
                mediaPath: { not: null },
            },
        });
        if (referencedMediaCount > 0) {
            logger.info(
                { sessionId, referencedMediaCount },
                'Keeping session media because Inbox messages still reference it',
            );
            return { success: true };
        }
        
        return new Promise((resolve) => {
            fs.rm(subDirectoryPath, { recursive: true }, (err) => {
                if (err) {
                    if (err.code !== 'ENOENT') {
                        logger.error({ error: err, path: subDirectoryPath }, 'Error deleting media directory');
                        resolve({ success: false, error: err.message });
                    } else {
                        logger.debug({ path: subDirectoryPath }, 'Media directory does not exist, skipping deletion');
                        resolve({ success: true }); // Not an error if doesn't exist
                    }
                } else {
                    logger.info({ path: subDirectoryPath }, 'Media directory deleted successfully');
                    resolve({ success: true });
                }
            });
        });
    };
    
    /**
     * Cleanup WhatsApp groups from database
     */
    const cleanupWhatsAppGroups = async (): Promise<{ success: boolean; error?: string }> => {
        try {
            await WhatsAppGroupService.clearWhatsAppGroups(deviceId, sessionId);
            logger.info({ sessionId, deviceId }, 'WhatsApp groups cleared on session destroy');
            return { success: true };
        } catch (error: any) {
            logger.error({ error, sessionId, deviceId }, 'Failed to clear WhatsApp groups on destroy');
            return { success: false, error: error?.message || 'Unknown error' };
        }
    };
    
    /**
     * Logout from WhatsApp
     */
    const cleanupWhatsAppSession = async (shouldLogout: boolean): Promise<{ success: boolean; error?: string }> => {
        if (!shouldLogout) {
            closeSocketTransport(sock);
            return { success: true };
        }

        try {
            const companionJid = sock.user?.id;
            if (!companionJid) {
                return { success: false, error: 'Session belum terautentikasi' };
            }
            if (!sock.ws.isOpen) {
                return { success: false, error: 'Koneksi WhatsApp tidak terbuka' };
            }

            // Baileys' sock.logout() only writes the removal stanza to the
            // websocket. Using query() waits for WhatsApp's IQ response, so a
            // successful result means the companion-device removal was
            // acknowledged by the server before local credentials are purged.
            await sock.query(
                {
                    tag: 'iq',
                    attrs: {
                        to: S_WHATSAPP_NET,
                        type: 'set',
                        id: sock.generateMessageTag(),
                        xmlns: 'md',
                    },
                    content: [
                        {
                            tag: 'remove-companion-device',
                            attrs: {
                                jid: companionJid,
                                reason: 'user_initiated',
                            },
                        },
                    ],
                },
                REMOTE_LOGOUT_TIMEOUT_MS,
            );

            // The server has acknowledged removal. Retire the local transport
            // without firing the normal reconnect handler.
            closeSocketTransport(sock);
            return { success: true };
        } catch (err: any) {
            logger.error({ error: err, sessionId }, 'Remote WhatsApp logout was not acknowledged');
            return { success: false, error: err?.message || 'Unknown error' };
        }
    };

    // Main destroy function - orchestrates all cleanup
    const destroy = async (logout = true, purgeAuth = logout) => {
        const currentInstance = instances.get(sessionId);
        if (!isActiveGeneration() || (currentInstance && currentInstance.ws !== sock.ws)) {
            logger.info(
                { sessionId, deviceId },
                'Ignoring cleanup from a superseded WhatsApp instance',
            );
            return {
                logoutAttempted: false,
                logoutSucceeded: false,
                failures: ['Instance superseded'],
            };
        }

        // A remote logout must finish before the instance, auth rows, or socket
        // state are removed. Otherwise a closed websocket can be mistaken for
        // a successful unlink while the device remains listed in WhatsApp.
        const logoutResult = await cleanupWhatsAppSession(logout);
        if (!logoutResult.success) {
            clearManualLogout(deviceId);
            const failure = `Logout: ${logoutResult.error || 'Tidak dikonfirmasi WhatsApp'}`;
            logger.warn(
                { sessionId, deviceId, failure },
                'Keeping local credentials because remote WhatsApp logout failed',
            );
            return {
                logoutAttempted: logout,
                logoutSucceeded: false,
                failures: [failure],
            };
        }

        const reconnectTimer = reconnectTimers.get(sessionId);
        if (reconnectTimer) {
            clearTimeout(reconnectTimer);
            reconnectTimers.delete(sessionId);
        }

        // 🔧 CRITICAL FIX: Delete dari Maps FIRST (before any async operations)
        // Ini mencegah race condition di mana destroy() lama menghapus entry baru
        if (SSE) {
            activeSSEConnections.delete(deviceId);
            logger.info({ deviceId, sessionId }, '🔧 [RACE CONDITION FIX] SSE connection removed from tracking BEFORE async cleanup');
        }
        if (instances.get(sessionId)?.ws === sock.ws) {
            instances.delete(sessionId);
        }
        if (deviceSessionOwners.get(deviceId) === sessionId) {
            deviceSessionOwners.delete(deviceId);
        }
        circuitOpenSessions.delete(sessionId);
        conflictRecoveryAttempts.delete(sessionId);
        recipient463Cooldowns.delete(sessionId);
        reachoutTimelockFetchTimestamps.delete(sessionId);
        clearManualLogout(deviceId);
        socketGenerations.clear(sessionId, generation);
        removeSessionState(sessionId); // 🔧 FIX: Cleanup centralized state
        logger.info({ sessionId }, '🔧 [RACE CONDITION FIX] Instance and state removed from maps BEFORE async cleanup');
        
        // 🆕 Close SSE stream jika ada
        if (sseCleanup) {
            try {
                sseCleanup();
            } catch (e) {
                logger.error({ error: e, sessionId }, 'Error closing SSE stream');
            }
        }
        
        // 🔧 REFACTORED: Run all cleanup operations in parallel with individual error handling
        const cleanupResults = await Promise.allSettled([
            purgeAuth
                ? cleanupWhatsAppGroups()
                : Promise.resolve({ success: true } as { success: boolean; error?: string }),
            purgeAuth
                ? cleanupDatabaseRecords()
                : Promise.resolve({ success: true, errors: [] as string[] }),
            purgeAuth
                ? cleanupMediaFiles()
                : Promise.resolve({ success: true } as { success: boolean; error?: string }),
        ]);
        
        // 🔧 Log summary of cleanup results
        const [groupsResult, dbResult, mediaResult] = cleanupResults;
        
        const failures: string[] = [];
        
        if (groupsResult.status === 'fulfilled' && !groupsResult.value.success) {
            failures.push(`WhatsApp Groups: ${groupsResult.value.error}`);
        } else if (groupsResult.status === 'rejected') {
            failures.push(`WhatsApp Groups: ${groupsResult.reason?.message || 'Unknown error'}`);
        }
        
        if (dbResult.status === 'fulfilled' && !dbResult.value.success) {
            failures.push(`Database: ${dbResult.value.errors.join(', ')}`);
        } else if (dbResult.status === 'rejected') {
            failures.push(`Database: ${dbResult.reason?.message || 'Unknown error'}`);
        }
        
        if (mediaResult.status === 'fulfilled' && !mediaResult.value.success) {
            failures.push(`Media Files: ${mediaResult.value.error}`);
        } else if (mediaResult.status === 'rejected') {
            failures.push(`Media Files: ${mediaResult.reason?.message || 'Unknown error'}`);
        }
        
        if (failures.length > 0) {
            logger.warn({ sessionId, deviceId, failures }, '⚠️ Session destroy completed with some failures');
        } else {
            logger.info(
                { sessionId, deviceId, purgeAuth },
                purgeAuth
                    ? '✅ Session destroy and credential purge completed successfully'
                    : '✅ Session transport retired; credentials and persisted data retained',
            );
        }

        return {
            logoutAttempted: logout,
            logoutSucceeded: true,
            failures,
        };
    };

    const handleConnectionClose = async () => {
        const activeInstance = instances.get(sessionId);
        if (!isActiveGeneration() || (activeInstance && activeInstance.ws !== sock.ws)) {
            logger.debug({ sessionId, deviceId }, 'Ignoring close from superseded socket');
            return;
        }
        if (circuitOpenSessions.has(sessionId)) return;

        // 🔧 FIX: Gunakan centralized state (Issue 3.5)
        const currentState = getState();
        const lastDisconnect = currentState?.connectionState.lastDisconnect;
        const code = (lastDisconnect?.error as Boom)?.output?.statusCode;
        const restartRequired = code === DisconnectReason.restartRequired;
        const errorMessage = (lastDisconnect?.error as Boom)?.message || 'Connection closed';
        const conflictAttempts = conflictRecoveryAttempts.get(sessionId) ?? 0;
        const recoverConflict = isRecoverableConnectionConflict(
            code,
            errorMessage,
            conflictAttempts,
        );

        if (recoverConflict) {
            conflictRecoveryAttempts.set(sessionId, conflictAttempts + 1);
            logger.warn(
                { sessionId, deviceId, code, conflictAttempts: conflictAttempts + 1 },
                'Recovering once from WhatsApp stream conflict without deleting credentials',
            );
        }
        
        // 🆕 Check if SSE was aborted - jika iya, jangan reconnect
        if (SSE && isSSEAborted(deviceId)) {
            logger.info(
                { sessionId, deviceId },
                'SSE was aborted by user - skipping reconnection'
            );
            await publishDeviceConnectionStatus(deviceId, sessionId, 'close');
            await destroy(false);
            return;
        }
        
        // 🆕 Log disconnect reason untuk debugging
        logger.info(
            { sessionId, deviceId, code, restartRequired },
            'Connection closed - evaluating reconnection'
        );

        // 🔥 Record connection error signal for ban detection
        // Skip jika ini manual logout (user sengaja logout via API)
        if (code && code !== DisconnectReason.restartRequired && code !== 515 && !recoverConflict) {
            if (isManualLogout(deviceId)) {
                logger.info(
                    { sessionId, deviceId, code },
                    'Skipping signal recording - manual logout detected'
                );
                clearManualLogout(deviceId);
            } else {
                recordConnectionError(deviceId, code, errorMessage).catch((err) => {
                    logger.error({ err }, 'Failed to record connection error signal');
                });
            }
        }

        // 🆕 Jika logout, langsung destroy tanpa reconnect
        const terminalDisconnectCodes = new Set<number>([
            DisconnectReason.loggedOut,
            DisconnectReason.forbidden,
            DisconnectReason.multideviceMismatch,
            DisconnectReason.connectionReplaced,
            DisconnectReason.badSession,
        ]);
        if (code && terminalDisconnectCodes.has(code) && !recoverConflict) {
            logger.info({ sessionId, deviceId, code }, 'Terminal disconnect - removing invalid session');
            if (res && !res.writableEnded) {
                if (SSE) {
                    res.write(
                        `data: ${JSON.stringify({
                            connection: 'logged_out',
                            message: 'Sesi WhatsApp tidak valid atau telah digantikan. Silakan pairing ulang.',
                        })}\n\n`,
                    );
                } else {
                    res.status(200).json({ message: 'Logged out successfully' });
                }
                res.end();
            }
            await publishDeviceConnectionStatus(deviceId, sessionId, 'logged_out');
            await destroy(false, true); // transport sudah ditutup; purge sesi invalid secara eksplisit
            return;
        }

        const attempt = nextReconnectAttempt(sessionId);
        const reconnectLimit = isConnectionSuccessful(sessionId)
            ? MAX_BACKGROUND_RECONNECT_RETRIES
            : SSE
              ? MAX_RECONNECT_RETRIES
              : MAX_BACKGROUND_RECONNECT_RETRIES;

        // Pairing via SSE has a bounded lifetime. Existing authenticated sessions
        // keep retrying with a capped delay so a temporary outage never deletes
        // credentials or forces a new QR pairing.
        if (attempt > reconnectLimit) {
            logger.warn(
                { sessionId, deviceId, attempt },
                'Reconnect circuit opened; credentials retained for manual recovery',
            );
            if (res && !res.writableEnded) {
                res.write(
                    `data: ${JSON.stringify({
                        error: 'Gagal terhubung setelah beberapa percobaan. Silakan coba lagi.',
                        maxRetriesReached: true,
                    })}\n\n`,
                );
                res.end();
            }
            circuitOpenSessions.add(sessionId);
            const reconnectTimer = reconnectTimers.get(sessionId);
            if (reconnectTimer) clearTimeout(reconnectTimer);
            reconnectTimers.delete(sessionId);
            instances.delete(sessionId);
            conflictRecoveryAttempts.delete(sessionId);
            socketGenerations.clear(sessionId, generation);
            removeSessionState(sessionId);
            if (deviceSessionOwners.get(deviceId) === sessionId) {
                deviceSessionOwners.delete(deviceId);
            }
            await publishDeviceConnectionStatus(deviceId, sessionId, 'close');
            try {
                sock.ws.close();
            } catch {
                // Socket may already be fully closed.
            }
            return;
        }

        markReconnecting(sessionId);
        await publishDeviceConnectionStatus(deviceId, sessionId, 'reconnecting');

        // 🆕 Inform user tentang reconnection attempt
        if (res && !res.writableEnded && SSE) {
            res.write(
                `data: ${JSON.stringify({
                    connection: 'reconnecting',
                    attempt,
                    maxAttempts: MAX_RECONNECT_RETRIES,
                    message: `Mencoba menghubungkan ulang... (${Math.min(attempt, MAX_RECONNECT_RETRIES)}/${MAX_RECONNECT_RETRIES})`,
                })}\n\n`,
            );
        }

        // 🆕 Check lagi sebelum reconnect
        if (SSE && isSSEAborted(deviceId)) {
            logger.info({ sessionId, deviceId }, 'SSE aborted during reconnect evaluation');
            await publishDeviceConnectionStatus(deviceId, sessionId, 'close');
            await destroy(false);
            return;
        }

        // Reconnect untuk kasus lain (connection lost, restart required, dll)
        if (!restartRequired) {
            logger.info({ attempts: retries.get(sessionId) ?? 1, sessionId }, 'Reconnecting...');
        }
        const reconnectDelay = restartRequired
            ? 0
            : getReconnectDelay(attempt, RECONNECT_INTERVAL, RECONNECT_MAX_INTERVAL);
        const existingTimer = reconnectTimers.get(sessionId);
        if (existingTimer) clearTimeout(existingTimer);

        const timer = setTimeout(() => {
            reconnectTimers.delete(sessionId);
            if (!isActiveGeneration()) return;
            const replacementOptions: createInstanceOptions = isConnectionSuccessful(sessionId)
                ? {
                      ...options,
                      res: undefined,
                      SSE: false,
                      sseCleanup: undefined,
                      replaceExisting: true,
                  }
                : { ...options, replaceExisting: true };
            void createInstance(replacementOptions).catch(async (error) => {
                logger.error(
                    { error, sessionId, deviceId, attempt },
                    'Failed to recreate WhatsApp instance',
                );
                if (!SSE) {
                    await handleConnectionClose().catch((reconnectError) => {
                        logger.error(
                            { error: reconnectError, sessionId, deviceId },
                            'Failed to schedule the next WhatsApp reconnect',
                        );
                    });
                }
            });
        }, reconnectDelay);
        reconnectTimers.set(sessionId, timer);
    };

    const handleNormalConnectionUpdate = async () => {
        // 🔧 FIX: Gunakan centralized state (Issue 3.5)
        const currentState = getState();
        const qrCode = currentState?.connectionState.qr;
        
        if (qrCode?.length) {
            if (res && !res.headersSent) {
                try {
                    const qr = await toDataURL(qrCode);
                    res.status(200).json({ qr, sessionId });
                    return;
                } catch (e) {
                    logger.error(e, 'An error occurred during QR generation');
                    res.status(500).json({ error: 'Unable to generate QR' });
                    res.end();
                }
            }
            // Don't destroy the session immediately, let it continue for potential reconnection
            return;
        }

        // Connection close will be handled by handleConnectionClose() in connection.update event
    };

    const handleSSEConnectionUpdate = async () => {
        // 🔧 FIX: Gunakan centralized state (Issue 3.5)
        const currentState = getState();
        const qrCode = currentState?.connectionState.qr;
        const connSuccessful = currentState?.connectionSuccessful ?? false;
        
        let qr: string | undefined = undefined;
        let qrAscii: string | undefined = undefined;

        if (qrCode?.length) {
            try {
                qr = await toDataURL(qrCode);
                try {
                    qrAscii = await qrToString(qrCode, {
                        type: 'terminal',
                        small: true,
                    });
                } catch (e) {
                    logger.error(e, 'An error occurred during QR ASCII generation');
                }
            } catch (e) {
                logger.error(e, 'An error occurred during QR generation');
                // Continue even if QR generation fails
            }
        }

        const currentGenerations = SSEQRGenerations.get(sessionId) ?? 0;
        const maxGenerations = Math.max(1, SSE_MAX_QR_GENERATION);

        // 🔧 FIX: Check if response is still writable, tapi JANGAN destroy jika koneksi sudah berhasil
        if (!res || res.writableEnded) {
            // Hanya destroy jika koneksi BELUM berhasil (masih dalam proses pairing)
            if (!connSuccessful) {
                logger.info({ sessionId, deviceId }, 'SSE stream closed before connection success - destroying session');
                void destroy(false);
            } else {
                logger.info({ sessionId, deviceId }, 'SSE stream closed after connection success - keeping session alive');
            }
            return;
        }

        // If we have QR and reached max generations, end gracefully
        if (qr && currentGenerations >= maxGenerations) {
            const data = { 
                ...(currentState?.connectionState || {}), 
                qr, 
                qrRaw: qrAscii, 
                maxGenerationsReached: true,
                message: 'QR code kedaluwarsa. Silakan mulai pairing ulang.',
            };
            res.write(`data: ${JSON.stringify(data)}\n\n`);
            setTimeout(() => {
                if (!res.writableEnded) {
                    res.end();
                }
                void destroy(false);
            }, 1000); // Give time for the client to receive the final QR
            return;
        }

        const data = { ...(currentState?.connectionState || {}), qr, qrRaw: qrAscii };
        if (qr) SSEQRGenerations.set(sessionId, currentGenerations + 1);

        try {
            res.write(`data: ${JSON.stringify(data)}\n\n`);
        } catch (e) {
            logger.error(e, 'Error writing SSE data');
            // 🔧 FIX: Jangan destroy jika koneksi sudah berhasil
            if (!connSuccessful) {
                void destroy(false);
            }
            return;
        }

        // Don't end the connection immediately, let it continue for more QR updates or connection success
    };

    const handleConnectionUpdate = SSE ? handleSSEConnectionUpdate : handleNormalConnectionUpdate;

    const { state, saveCreds } = await useSession(sessionId, deviceId);

    // Fetch latest WhatsApp version for QR compatibility
    const FALLBACK_VERSION: [number, number, number] = [2, 3000, 1033105955];
    let waVersion: [number, number, number] = FALLBACK_VERSION;
    try {
        const { version, isLatest } = await fetchLatestBaileysVersion();
        if (version && Array.isArray(version)) {
            waVersion = version as [number, number, number];
            logger.info(`[WA-VERSION] ✅ Auto-fetched: [${version.join(', ')}] ${isLatest ? '(latest)' : '(may not be latest)'}`);
        }
    } catch (e) {
        logger.warn(`[WA-VERSION] ⚠️ Fetch failed, using fallback: [${FALLBACK_VERSION.join(', ')}]`);
    }

    // back here: adjust SocketConfig such as turn off always online
    const sock = makeWASocket({
        // printQRInTerminal removed due to deprecation; handled manually in connection.update
        version: waVersion,
        browser: ['Autosender', 'Chrome', '143.0.0.0'],
        ...socketConfig,
        auth: {
            creds: state.creds,
            keys: makeCacheableSignalKeyStore(state.keys, logger as any),
        },
        logger: logger as any,
        markOnlineOnConnect: false,
        // Process bootstrap/app-state history internally so Baileys can restore
        // LID mappings and trusted-contact tokens. FULL chat history remains
        // disabled, and Inbox deliberately ignores messaging-history.set.
        syncFullHistory: false,
        shouldSyncHistoryMessage: shouldProcessHistorySync,

        getMessage: async (key) => {
            const data = await prisma.message.findFirst({
                where: { remoteJid: key.remoteJid!, id: key.id!, sessionId },
            });
            return (data?.message || undefined) as proto.IMessage | undefined;
        },
    });

    const store = new Store(sessionId, sock.ev, deviceId);
    instances.set(sessionId, {
        ...sock,
        destroy,
        store,
        deviceId,
        generation,
        getSendReadiness,
    });

    sock.ev.on('creds.update', async () => {
        if (!isActiveGeneration()) return;
        try {
            await saveCreds();
        } catch (error) {
            // The key store intentionally propagates persistence failures. Catch
            // them at the event boundary so they are visible without becoming an
            // unhandled promise rejection that can terminate the process.
            logger.error(
                { error, sessionId, deviceId },
                'Failed to persist WhatsApp credential update',
            );
        }
    });
    sock.ev.on('connection.update', async (update) => {
        if (!isActiveGeneration()) {
            logger.debug(
                { sessionId, deviceId, generation },
                'Ignoring connection update from retired WhatsApp socket',
            );
            return;
        }
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

        // 🔧 FIX: Update centralized state (Issue 3.5)
        updateConnectionState(sessionId, update);
        const connection = normalizeConnectionUpdate(update.connection);

        // QR and other Baileys events are partial updates. They still need to
        // reach the pairing handler, but must never overwrite device status.
        if (!connection) {
            await handleConnectionUpdate();
            return;
        }

        try {
        if (connection === 'open') {
            retries.delete(sessionId);
            SSEQRGenerations.delete(sessionId);
            const reconnectTimer = reconnectTimers.get(sessionId);
            if (reconnectTimer) {
                clearTimeout(reconnectTimer);
                reconnectTimers.delete(sessionId);
            }

            // 🔧 FIX: Mark connection successful di centralized state
            markConnectionSuccessful(sessionId);

            // Pairing ownership ends as soon as WhatsApp is authenticated. The
            // SSE response may now close without being mistaken for a cancelled
            // pairing and future reconnects run as background sessions.
            if (SSE) {
                activeSSEConnections.delete(deviceId);
            }

            // 🔥 Record successful reconnection for health tracking
            recordReconnection(deviceId).catch((err) => {
                logger.error({ err }, 'Failed to record reconnection signal');
            });

            // ?back here: forbid duplicate phone numbers
            const phone = sock.user?.id.split(':')[0];

            const connectedDevice = await prisma.device.update({
                where: { pkId: deviceId },
                data: { phone, updatedAt: new Date() },
            });

            if (!isActiveGeneration()) return;

            // Publish online immediately. Group/profile synchronization is
            // intentionally background work and may take several seconds.
            await publishDeviceConnectionStatus(deviceId, sessionId, 'open');

            if (!isActiveGeneration()) return;

            // Populate missing/stale profile pictures without putting WhatsApp
            // or CDN work in the browser-facing profile endpoint.
            void warmInboxProfileCache({
                deviceId,
                sessionId,
                session: sock,
                onAvailable: (jid) => {
                    const profileUrl = createInboxProfileUrl(connectedDevice.id, jid);
                    getSocketIO()
                        .to(`session:${sessionId}`)
                        .to(`device:${connectedDevice.id}`)
                        .emit(`incoming:${sessionId}:profile-updated`, {
                            from: jid,
                            profilePicUrl: jid.endsWith('@g.us') ? null : profileUrl,
                            groupPicUrl: jid.endsWith('@g.us') ? profileUrl : null,
                            profilePictureStatus: 'available',
                            isGroup: jid.endsWith('@g.us'),
                        });
                },
            });

            // 🆕 Send success message ke SSE sebelum close
            if (res && !res.writableEnded && SSE) {
                res.write(
                    `data: ${JSON.stringify({
                        connection: 'open',
                        message: 'WhatsApp berhasil terhubung!',
                        phone: phone,
                    })}\n\n`,
                );
                
                // 🆕 Force close SSE stream setelah berhasil connect
                setTimeout(() => {
                    if (sseCleanup) {
                        sseCleanup();
                    } else if (!res.writableEnded) {
                        res.end();
                    }
                }, 1000);
            }

            // Auto-sync WhatsApp groups saat koneksi berhasil. A slow group
            // fetch must not delay the real-time Online indicator.
            void (async () => {
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
            })();
        } else if (connection === 'close') {
            // Keep cached WhatsApp groups during temporary disconnects. They
            // are cleared only by explicit logout/device destruction.
            await handleConnectionClose();
        } else {
            await publishDeviceConnectionStatus(deviceId, sessionId, connection);
        }

        await handleConnectionUpdate();
        } catch (error: any) {
            // Handle case where device no longer exists
            if (error.code === 'P2025') {
                logger.warn(
                    { sessionId, deviceId, connection },
                    'Device not found during status update - device may have been deleted'
                );
                // Optionally destroy the instance if device is gone
                await destroy(false, true);
            } else {
                logger.error(
                    { error, sessionId, deviceId, connection },
                    'Error updating device status'
                );
            }
        }
    });

    if (readIncomingMessages) {
        sock.ev.on('messages.upsert', async (m) => {
            try {
                if (!isActiveGeneration()) return;
                const message = m.messages[0];
                if (!message.key || message.key.fromMe || m.type !== 'notify') return;

                // 🔧 FIX: Check connection via centralized state (Issue 3.5)
                if (!isSessionConnected(sessionId)) {
                    logger.debug({ sessionId }, 'Skipping read message - connection not open');
                    return;
                }

                await delay(1000);
                if (message.key) {
                    await sock.readMessages([message.key]);
                }
            } catch (error: any) {
                // Ignore connection closed errors
                if (error?.message !== 'Connection Closed') {
                    logger.error({ error, sessionId }, 'Error handling messages.upsert');
                }
            }
        });
    }

    // 🆕 Listen untuk grup baru yang di-join
    sock.ev.on('groups.upsert', async (groups) => {
        try {
            if (!isActiveGeneration()) return;
            // 🔧 FIX: Check connection via centralized state (Issue 3.5)
            if (!isSessionConnected(sessionId)) {
                logger.debug({ sessionId }, 'Skipping groups.upsert - connection not open');
                return;
            }

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
                        io.to(`device:${device.id}`).emit(`device:${device.id}:group-joined`, {
                            groupId: group.id,
                            groupName: groupData.subject,
                            participants: groupMetadata.participants?.length || 0,
                            isActive: true,
                            sessionId: sessionId,
                        });
                        
                        // Emit event umum bahwa ada update di daftar grup
                        io.to(`device:${device.id}`).emit(`device:${device.id}:groups-updated`, {
                            action: 'group-joined',
                            groupId: group.id,
                            timestamp: new Date().toISOString(),
                        });
                        
                        logger.info(
                            { deviceId: device.id, groupId: group.id },
                            'Socket.IO events emitted for new group'
                        );
                    }
                } catch (groupError: any) {
                    // Ignore connection closed errors
                    if (groupError?.message !== 'Connection Closed') {
                        logger.error(
                            { error: groupError, sessionId, deviceId, groupId: group.id },
                            'Failed to process new group'
                        );
                    }
                }
            }
        } catch (error: any) {
            // Ignore connection closed errors
            if (error?.message !== 'Connection Closed') {
                logger.error(
                    { error, sessionId, deviceId },
                    'Failed to handle groups.upsert event'
                );
            }
        }
    });

    // 🆕 Listen untuk update grup (nama berubah, participant berubah, dll)
    sock.ev.on('groups.update', async (updates) => {
        try {
            if (!isActiveGeneration()) return;
            // 🔧 FIX: Check connection via centralized state (Issue 3.5)
            if (!isSessionConnected(sessionId)) {
                logger.debug({ sessionId }, 'Skipping groups.update - connection not open');
                return;
            }

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
                        io.to(`device:${device.id}`).emit(`device:${device.id}:groups-updated`, {
                            action: 'group-updated',
                            groupId: update.id,
                            timestamp: new Date().toISOString(),
                        });
                    }
                } catch (updateError: any) {
                    // Ignore connection closed errors
                    if (updateError?.message !== 'Connection Closed') {
                        logger.error(
                            { error: updateError, sessionId, deviceId, groupId: update.id },
                            'Failed to process group update'
                        );
                    }
                }
            }
        } catch (error: any) {
            // Ignore connection closed errors
            if (error?.message !== 'Connection Closed') {
                logger.error(
                    { error, sessionId, deviceId },
                    'Failed to handle groups.update event'
                );
            }
        }
    });

    // 🆕 Listen untuk participant changes (termasuk ketika device keluar/dikick dari grup)
    sock.ev.on('group-participants.update', async (update) => {
        try {
            if (!isActiveGeneration()) return;
            // 🔧 FIX: Check connection via centralized state (Issue 3.5)
            if (!isSessionConnected(sessionId)) {
                logger.debug({ sessionId }, 'Skipping group-participants.update - connection not open');
                return;
            }

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
                    io.to(`device:${device.id}`).emit(`device:${device.id}:group-left`, {
                        groupId: groupId,
                        action: action,
                        timestamp: new Date().toISOString(),
                    });
                    
                    io.to(`device:${device.id}`).emit(`device:${device.id}:groups-updated`, {
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
                        io.to(`device:${device.id}`).emit(`device:${device.id}:groups-updated`, {
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
        } catch (error: any) {
            // Ignore connection closed errors
            if (error?.message !== 'Connection Closed') {
                logger.error(
                    { error, sessionId, deviceId },
                    'Failed to handle group-participants.update event'
                );
            }
        }
    });

    // 🆕 Listen untuk chats.update - mendeteksi ketika keluar dari grup
    sock.ev.on('chats.update', async (chats) => {
        try {
            if (!isActiveGeneration()) return;
            // 🔧 FIX: Check connection via centralized state (Issue 3.5)
            if (!isSessionConnected(sessionId)) {
                logger.debug({ sessionId }, 'Skipping chats.update - connection not open');
                return;
            }

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
                                io.to(`device:${device.id}`).emit(`device:${device.id}:group-left`, {
                                    groupId: groupId,
                                    action: 'leave',
                                    timestamp: new Date().toISOString(),
                                });
                                
                                io.to(`device:${device.id}`).emit(`device:${device.id}:groups-updated`, {
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
        } catch (error: any) {
            // Ignore connection closed errors
            if (error?.message !== 'Connection Closed') {
                logger.error(
                    { error, sessionId, deviceId },
                    'Failed to handle chats.update event'
                );
            }
        }
    });

    // 🆕 Listen untuk message receipts (delivered & read status)
    sock.ev.on('messages.update', async (updates) => {
        try {
            if (!isActiveGeneration()) return;
            for (const update of updates) {
                try {
                    if (!update.key) continue;

                    const messageId = update.key.id;
                    if (!messageId) continue;

                    // Baileys converts WhatsApp MESSAGE_EDIT protocol messages
                    // into messages.update events whose key points to the
                    // original message. Apply incoming edits in-place before
                    // the outgoing ACK/NACK branch below.
                    const messageEdit = extractMessageEdit(update.update);
                    if (messageEdit) {
                        // Do not trust fromMe here: for edits Baileys can keep
                        // the sender-perspective flag on the target key. The
                        // scoped incoming-message lookup is the source of truth.
                        await applyIncomingMessageEdit({
                            sessionId,
                            deviceId,
                            messageId,
                            text: messageEdit.text,
                            editedAt: messageEdit.editedAt,
                            remoteJid: update.key.remoteJid,
                        });
                        continue;
                    }

                    // The remaining messages.update states are delivery
                    // updates for messages sent by this account.
                    if (!update.key.fromMe) continue;

                    // Determine new status from update
                    let newStatus: string | null = null;
                    const failureCode = String(
                        update.update?.messageStubParameters?.[0] || '',
                    ).trim();
                    
                    if (update.update?.status === 0) {
                        // Status 0 = WhatsApp rejected the message after the
                        // initial server ACK. This used to be ignored, leaving
                        // the Inbox permanently showing one checkmark.
                        newStatus = 'error';
                    } else if (update.update?.status === 2) {
                        // Status 2 = SERVER_ACK (sent - 1 centang)
                        newStatus = 'server_ack';
                    } else if (update.update?.status === 3) {
                        // Status 3 = DELIVERY_ACK (delivered - 2 centang abu-abu)
                        newStatus = 'delivery_ack';
                    } else if (update.update?.status === 4) {
                        // Status 4 = READ (read - 2 centang biru)
                        newStatus = 'read';
                    } else if (update.update?.status === 5) {
                        // Status 5 = PLAYED (for voice notes)
                        newStatus = 'played';
                    }

                    if (newStatus) {
                        const newLevel = outgoingMessageStatusLevel(newStatus);

                        // The database filter makes transitions atomic: a
                        // delayed ACK cannot revive error/failed, while NACK is
                        // still allowed to replace pending/submitted/server_ack.
                        const eligibleStatuses = eligibleOutgoingMessageStatuses(newStatus);

                        if (newStatus === 'error') {
                            logger.warn(
                                {
                                    sessionId,
                                    messageId,
                                    failureCode: failureCode || 'unknown',
                                    addressing: update.key.remoteJid?.includes('@lid')
                                        ? 'lid'
                                        : 'pn',
                                },
                                '[DeliveryReceipt] WhatsApp rejected outgoing message',
                            );

                            if (
                                failureCode === '463' &&
                                typeof sock.fetchAccountReachoutTimelock === 'function'
                            ) {
                                setRecipient463Cooldown(sessionId, update.key.remoteJid);

                                // rc14 classifies 463 in an earlier branch and
                                // therefore never reaches its timelock fetch.
                                // Refresh at most once per interval; the result
                                // is persisted in centralized connection state
                                // through connection.update. Never retry the
                                // rejected message automatically.
                                const now = Date.now();
                                const lastRefresh =
                                    reachoutTimelockFetchTimestamps.get(sessionId) || 0;
                                if (now - lastRefresh >= REACHOUT_TIMELOCK_REFRESH_MS) {
                                    reachoutTimelockFetchTimestamps.set(sessionId, now);
                                    void sock.fetchAccountReachoutTimelock().catch(error => {
                                        logger.warn(
                                            { error, sessionId, messageId },
                                            'Failed to fetch WhatsApp reachout timelock after 463',
                                        );
                                    });
                                }
                            }

                        }
                        
                        // First, try to update by waMessageId (only if status would upgrade)
                        const updateResult = await prisma.outgoingMessage.updateMany({
                            where: {
                                waMessageId: messageId,
                                sessionId,
                                // ✅ CRITICAL: Only update messages with LOWER status
                                status: { in: eligibleStatuses },
                            },
                            data: {
                                status: newStatus,
                                updatedAt: new Date(),
                            },
                        });

                        if (updateResult.count > 0) {
                            logger.info(
                                { sessionId, messageId, newStatus, newLevel, updatedCount: updateResult.count },
                                '✅ Message status UPGRADED in database (matched by waMessageId)'
                            );

                            // Emit Socket.IO event untuk real-time update di frontend
                            const io: Server = getSocketIO();
                            const device = await prisma.device.findFirst({
                                where: {
                                    sessions: {
                                        some: { sessionId },
                                    },
                                },
                            });

                            if (device) {
                                let statusMessage = await prisma.outgoingMessage.findFirst({
                                    where: { waMessageId: messageId, sessionId },
                                    select: {
                                        pkId: true,
                                        id: true,
                                        waMessageId: true,
                                        to: true,
                                        isGroup: true,
                                        readBy: true,
                                        readReceipts: true,
                                    },
                                });
                                if (
                                    statusMessage
                                    && newStatus === 'read'
                                    && !statusMessage.isGroup
                                    && statusMessage.to
                                ) {
                                    const readBy = new Set(
                                        Array.isArray(statusMessage.readBy)
                                            ? statusMessage.readBy.map(String)
                                            : [],
                                    );
                                    readBy.add(statusMessage.to);
                                    statusMessage = await prisma.outgoingMessage.update({
                                        where: { pkId: statusMessage.pkId },
                                        data: {
                                            readBy: Array.from(readBy),
                                            readReceipts: upsertMessageReadReceipt(
                                                statusMessage.readReceipts,
                                                {
                                                    readerJid: statusMessage.to,
                                                    readAt: new Date().toISOString(),
                                                    estimated: true,
                                                },
                                            ) as unknown as Prisma.InputJsonValue,
                                        },
                                        select: {
                                            pkId: true,
                                            id: true,
                                            waMessageId: true,
                                            to: true,
                                            isGroup: true,
                                            readBy: true,
                                            readReceipts: true,
                                        },
                                    });
                                }
                                io.to(`device:${device.id}`).emit(`device:${device.id}:message-status`, {
                                    id: statusMessage?.id || messageId,
                                    messageId: statusMessage?.id || messageId,
                                    outgoingPkId: statusMessage?.pkId || null,
                                    waMessageId: statusMessage?.waMessageId || messageId,
                                    status: newStatus,
                                    errorCode: newStatus === 'error' ? failureCode || null : null,
                                    to: statusMessage?.to || update.key.remoteJid,
                                    conversationJid: statusMessage?.to || update.key.remoteJid,
                                    isGroup:
                                        statusMessage?.isGroup
                                        ?? Boolean((statusMessage?.to || update.key.remoteJid)?.includes('@g.us')),
                                    ...(statusMessage && Array.isArray(statusMessage.readBy)
                                        ? {
                                              readCount: statusMessage.readBy.length,
                                              readBy: statusMessage.readBy,
                                              readReceipts: statusMessage.readReceipts || [],
                                          }
                                        : {}),
                                    timestamp: new Date().toISOString(),
                                });
                            }
                        } else {
                            // ⚠️ waMessageId match failed, try backup strategy: update by id field
                            // (id field is set to waMessageId or fallback value when saving)
                            const backupUpdateResult = await prisma.outgoingMessage.updateMany({
                                where: {
                                    id: messageId,
                                    sessionId,
                                    // ✅ CRITICAL: Only update messages with LOWER status
                                    status: { in: eligibleStatuses },
                                },
                                data: {
                                    status: newStatus,
                                    waMessageId: messageId, // ✅ Also set waMessageId now that we have it
                                    updatedAt: new Date(),
                                },
                            });
                            
                            if (backupUpdateResult.count > 0) {
                                logger.info(
                                    { sessionId, messageId, newStatus, newLevel, updatedCount: backupUpdateResult.count },
                                    '✅ Message status UPGRADED in database (matched by id field, also set waMessageId)'
                                );
                                
                                // Emit Socket.IO event
                                const io: Server = getSocketIO();
                                const device = await prisma.device.findFirst({
                                    where: {
                                        sessions: {
                                            some: { sessionId },
                                        },
                                    },
                                });

                                if (device) {
                                    let statusMessage = await prisma.outgoingMessage.findFirst({
                                        where: { id: messageId, sessionId },
                                        select: {
                                            pkId: true,
                                            id: true,
                                            waMessageId: true,
                                            to: true,
                                            isGroup: true,
                                            readBy: true,
                                            readReceipts: true,
                                        },
                                    });
                                    if (
                                        statusMessage
                                        && newStatus === 'read'
                                        && !statusMessage.isGroup
                                        && statusMessage.to
                                    ) {
                                        const readBy = new Set(
                                            Array.isArray(statusMessage.readBy)
                                                ? statusMessage.readBy.map(String)
                                                : [],
                                        );
                                        readBy.add(statusMessage.to);
                                        statusMessage = await prisma.outgoingMessage.update({
                                            where: { pkId: statusMessage.pkId },
                                            data: {
                                                readBy: Array.from(readBy),
                                                readReceipts: upsertMessageReadReceipt(
                                                    statusMessage.readReceipts,
                                                    {
                                                        readerJid: statusMessage.to,
                                                        readAt: new Date().toISOString(),
                                                        estimated: true,
                                                    },
                                                ) as unknown as Prisma.InputJsonValue,
                                            },
                                            select: {
                                                pkId: true,
                                                id: true,
                                                waMessageId: true,
                                                to: true,
                                                isGroup: true,
                                                readBy: true,
                                                readReceipts: true,
                                            },
                                        });
                                    }
                                    io.to(`device:${device.id}`).emit(`device:${device.id}:message-status`, {
                                        id: statusMessage?.id || messageId,
                                        messageId: statusMessage?.id || messageId,
                                        outgoingPkId: statusMessage?.pkId || null,
                                        waMessageId: statusMessage?.waMessageId || messageId,
                                        status: newStatus,
                                        errorCode: newStatus === 'error' ? failureCode || null : null,
                                        to: statusMessage?.to || update.key.remoteJid,
                                        conversationJid: statusMessage?.to || update.key.remoteJid,
                                        isGroup:
                                            statusMessage?.isGroup
                                            ?? Boolean((statusMessage?.to || update.key.remoteJid)?.includes('@g.us')),
                                        ...(statusMessage && Array.isArray(statusMessage.readBy)
                                            ? {
                                                  readCount: statusMessage.readBy.length,
                                                  readBy: statusMessage.readBy,
                                                  readReceipts: statusMessage.readReceipts || [],
                                              }
                                            : {}),
                                        timestamp: new Date().toISOString(),
                                    });
                                }
                            } else {
                                // Still no match - log warning
                                logger.warn(
                                    { 
                                        sessionId, 
                                        messageId, 
                                        newStatus,
                                        newLevel,
                                        remoteJid: update.key.remoteJid,
                                    },
                                    '⚠️ Message status update found 0 rows after both waMessageId and id attempts (might be because status would downgrade)'
                                );
                            }
                        }
                    }
                } catch (updateError: any) {
                    if (updateError?.message !== 'Connection Closed') {
                        logger.error(
                            { error: updateError, sessionId, update },
                            'Failed to process message status update'
                        );
                    }
                }
            }
        } catch (error: any) {
            if (error?.message !== 'Connection Closed') {
                logger.error(
                    { error, sessionId },
                    'Failed to handle messages.update event'
                );
            }
        }
    });

    // Debug events
    // sock.ev.on('chats.upsert', (data) => dump('chats.upsert', data));
    // sock.ev.on('contacts.update', (data) => dump('contacts.update', data));

}

export function verifyInstance(sessionId: string) {
    return instances.has(sessionId);
}

export function verifyDeviceSessionOwner(deviceId: number): boolean {
    return deviceSessionOwners.has(deviceId);
}

export function getInstance(sessionId: string) {
    const session = instances.get(sessionId);
    if (!verifyInstance(sessionId)) {
        throw new Error(`Session with sessionId ${sessionId} not found.`);
    }
    return session;
}

/**
 * Resolve the live WhatsApp owner for a device.
 *
 * A device can retain many Session rows because the table also stores auth
 * keys. After a QR relink or WhatsApp number change, reading `sessions[0]`
 * can therefore select a superseded session. `deviceSessionOwners` is the
 * runtime source of truth enforced by createInstance().
 */
export function getConnectedDeviceInstance(deviceId: number) {
    const sessionId = deviceSessionOwners.get(deviceId);
    if (!sessionId) return null;

    const session = instances.get(sessionId);
    if (
        !session ||
        !isSessionConnected(sessionId) ||
        !session.user ||
        !session.ws.isOpen
    ) {
        return null;
    }

    return { sessionId, session };
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

/**
 * Route legacy/session-scoped sends through the same pending, readiness,
 * idempotency, and receipt-tracking pipeline as Inbox and broadcasts.
 */
export async function sendTrackedSessionMessage(
    session: Instance,
    jid: string,
    content: any,
    options?: SendMessageOptions,
) {
    const device = await prisma.device.findUnique({
        where: { pkId: session.deviceId },
        select: { id: true },
    });
    if (!device) {
        throw new Error('Device tidak ditemukan untuk sesi WhatsApp aktif');
    }

    const queued = await sendGenericMessage(session, device.id, jid, content, options);
    if (!queued.success) {
        const error = new Error(queued.error || 'Gagal mengirim pesan WhatsApp') as Error & {
            code?: string;
            statusCode?: number;
        };
        error.code = queued.errorCode;
        error.statusCode = queued.statusCode;
        throw error;
    }
    return queued.result;
}

export async function deleteInstance(sessionId: string): Promise<{
    instanceFound: boolean;
    logoutAttempted: boolean;
    logoutSucceeded: boolean;
    failures: string[];
}> {
    const instance = instances.get(sessionId);
    if (!instance) {
        return {
            instanceFound: false,
            logoutAttempted: false,
            logoutSucceeded: false,
            failures: ['Instance WhatsApp tidak aktif'],
        };
    }

    const result = await instance.destroy();
    return { instanceFound: true, ...result };
}

// 🆕 Export helper untuk mark SSE as aborted
/**
 * Logout a linked device with server acknowledgement. If the process no longer
 * has an active socket, restore it from persisted credentials and wait briefly
 * for an authenticated connection before sending the removal query.
 */
export async function logoutDeviceSession(
    sessionId: string,
    deviceId: number,
): Promise<{
    instanceFound: boolean;
    logoutAttempted: boolean;
    logoutSucceeded: boolean;
    failures: string[];
}> {
    if (!instances.has(sessionId)) {
        try {
            const config = await prisma.session.findFirst({
                where: {
                    sessionId,
                    id: { startsWith: SESSION_CONFIG_ID },
                    deviceId,
                },
                select: { data: true },
            });
            if (!config) {
                return {
                    instanceFound: false,
                    logoutAttempted: false,
                    logoutSucceeded: false,
                    failures: ['Kredensial session WhatsApp tidak ditemukan'],
                };
            }

            const parsedConfig = JSON.parse(config.data || '{}');
            const { readIncomingMessages, ...socketConfig } = parsedConfig;
            await createInstance({
                sessionId,
                deviceId,
                readIncomingMessages,
                socketConfig,
            });
        } catch (error: any) {
            return {
                instanceFound: false,
                logoutAttempted: false,
                logoutSucceeded: false,
                failures: [`Gagal memulihkan koneksi WhatsApp: ${error?.message || 'Unknown error'}`],
            };
        }
    }

    const deadline = Date.now() + REMOTE_LOGOUT_TIMEOUT_MS;
    while (Date.now() < deadline) {
        const instance = instances.get(sessionId);
        if (instance?.ws.isOpen) {
            const result = await deleteInstance(sessionId);
            const remainingInstance = instances.get(sessionId);
            if (!result.logoutSucceeded && remainingInstance && !remainingInstance.ws.isOpen) {
                // A failed logout may coincide with a transport close. Retire
                // that dead socket without purging auth so a retry can restore it.
                await remainingInstance.destroy(false, false);
            }
            return result;
        }
        await delay(250);
    }

    const inactiveInstance = instances.get(sessionId);
    if (inactiveInstance) {
        // Stop the inactive connection attempt, but retain credentials so the
        // next logout request can restore it cleanly.
        await inactiveInstance.destroy(false, false);
    }

    return {
        instanceFound: Boolean(inactiveInstance),
        logoutAttempted: false,
        logoutSucceeded: false,
        failures: ['Koneksi WhatsApp tidak siap untuk mengirim permintaan logout'],
    };
}

export { markSSEAborted };

export async function verifyJid(session: Instance, jid: string, type: string = 'number') {
    if (type !== 'group') {
        if (jid.includes('@g.us')) return true;
        
        // Skip verification for @lid (Linked ID) format
        // Baileys onWhatsApp() doesn't support @lid, but messages can still be sent
        if (jid.includes('@lid')) {
            return true; // Trust the JID, skip verification
        }
        
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
    // If already has domain (@lid, @s.whatsapp.net, @g.us), return as-is
    if (jid.includes('@lid') || jid.includes('@g.us') || jid.includes('@s.whatsapp.net')) {
        return jid;
    }
    // If contains '-', it's a group
    // Otherwise, it's a regular number
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
                    fileName: file.originalName ?? file.newName,
                };
            } else {
                message = {
                    mimetype: file.mimetype,
                    [type]: file.buffer ?? { url: file.url },
                    caption: caption,
                    fileName: file.originalName ?? file.newName,
                };
            }

            const result = await sendTrackedSessionMessage(
                session,
                getJid(recipient),
                message,
                { quoted: data, messageId },
            );
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

        const result = await sendTrackedSessionMessage(session, recipientJid, {
            text: data.text || '',
            footer: data.footerText || '',
        });

        return result;
    } catch (error) {
        logger.error('Error sending button message:', error);
        throw error;
    }
}

// 🔧 FIX: Re-export session state utilities untuk monitoring (Issue 3.5)
export { 
    getSessionState,
    getSessionStateSummary,
    isSessionConnected,
    isConnectionSuccessful,
    getActiveSessionIds,
    getSessionCount,
} from './utils/sessionState';

/**
 * 🔧 Get connected sessions info for monitoring
 * Returns array of sessionId and phone number for connected sessions
 */
export function getConnectedSessionsInfo(): Array<{ sessionId: string; phone: string }> {
    const result: Array<{ sessionId: string; phone: string }> = [];
    
    for (const [sessionId, instance] of instances.entries()) {
        if (isSessionConnected(sessionId) && instance?.user) {
            result.push({
                sessionId,
                phone: instance.user.id?.split(':')[0] || 'unknown'
            });
        }
    }
    
    return result;
}
