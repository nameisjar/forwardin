import { RequestHandler } from 'express';
import { Prisma } from '@prisma/client';
import { generateUuid } from '../utils/keyGenerator';
import prisma, { serializePrisma } from '../utils/db';
import logger from '../config/logger';
import { generateSlug } from '../utils/slug';
import { useDevice } from '../utils/quota';
import fs from 'fs';
import path from 'path';
import schedule from 'node-schedule';
import sharp from 'sharp';
import { isUUID } from '../utils/uuidChecker';
import { generateDeviceAccessToken } from '../utils/jwtGenerator';
import {
    clearManualLogout,
    getInstance,
    logoutDeviceSession,
    markManualLogout,
    verifyInstance,
} from '../whatsapp';
import { getConnectionStatus, isReconnecting } from '../utils/sessionState';
import { deriveDeviceRuntimeStatus } from '../utils/connectionPolicy';
import { hashApiKey } from '../utils/apiKeyHash';
import {
    accessibleDeviceWhere,
    ownedDeviceWhere,
} from '../utils/deviceAccess';
import {
    createInboxProfileUrl,
    resolveInboxMediaType,
    serializeInboxMediaPath,
    verifyInboxMediaToken,
    verifyInboxProfileToken,
} from '../utils/inboxMedia';
import {
    getInboxProfileCache,
    getInboxProfileCacheSummaries,
    refreshInboxProfileCache,
} from '../services/inboxProfileCache';
import { decryptIncomingMessage, decryptMessage } from '../utils/messageEncryption';
import {
    deleteAllDeviceReactions,
    deleteConversationReactions,
    getConversationMessageReactions,
} from '../services/messageReaction';
import { cleanupMediaFilesIfUnreferenced } from '../services/mediaCleanup';
import {
    buildQuotedSenderIdentity,
    phoneFromWhatsAppJid,
} from '../services/inboxMessageQuote';
import {
    filterOwnMessageReadReceipts,
    filterOwnReadBy,
    resolveMessageReadReceipts,
    resolveReadReceiptIdentityAliases,
} from '../services/messageReadReceipt';
import {
    deleteAllDevicePolls,
    deleteConversationPolls,
    getMessagePollStates,
} from '../services/messagePoll';
import {
    buildOwnWhatsAppIdentityJids,
    canonicalPersonalPhoneJid,
    phoneJidFromMessageKey,
} from '../utils/whatsappIdentity';
import { 
    getDeviceHealth, 
    pauseDevice, 
    resumeDevice, 
    checkAutoResume,
    cleanupOldSignals,
} from '../services/signalDetector';

type RuntimeDevice = {
    status: string | null;
    sessions: Array<{ sessionId: string }>;
};

type WhatsAppIdentitySession = {
    user?: { id?: string | null; lid?: string | null } | null;
    signalRepository?: {
        lidMapping?: {
            getPNForLID?: (jid: string) => Promise<string | null | undefined>;
        };
    };
};

function getOwnIdentityJids(
    devicePhone: string | null | undefined,
    sessionId: string | null | undefined,
): string[] {
    let socketUser: { id?: string | null; lid?: string | null } | null = null;
    if (sessionId && verifyInstance(sessionId)) {
        try {
            socketUser = (getInstance(sessionId) as unknown as WhatsAppIdentitySession).user || null;
        } catch {
            socketUser = null;
        }
    }
    return buildOwnWhatsAppIdentityJids(devicePhone, socketUser);
}

const inboxContactSelect = {
    firstName: true,
    lastName: true,
    phone: true,
    colorCode: true,
    ContactLabel: {
        select: {
            label: { select: { name: true } },
        },
    },
} as const;

const inboxConversationSummarySelect = {
    jid: true,
    lastMessageAt: true,
    incomingCount: true,
    outgoingCount: true,
    unreadCount: true,
    isGroup: true,
    pushName: true,
    groupName: true,
    lastMessageId: true,
    lastMessageDirection: true,
    lastMessagePreview: true,
    lastMediaPath: true,
    lastFileName: true,
    contact: { select: inboxContactSelect },
} satisfies Prisma.ConversationSelect;

type InboxConversationSummary = Prisma.ConversationGetPayload<{
    select: typeof inboxConversationSummarySelect;
}>;

function getRuntimeDeviceStatus(device: RuntimeDevice) {
    const sessionId = device.sessions[0]?.sessionId;
    return deriveDeviceRuntimeStatus({
        databaseStatus: device.status,
        hasSession: Boolean(sessionId),
        hasInstance: Boolean(sessionId && verifyInstance(sessionId)),
        connection: sessionId ? getConnectionStatus(sessionId) : undefined,
        reconnecting: sessionId ? isReconnecting(sessionId) : false,
    });
}

export const getDevices: RequestHandler = async (req, res) => {
    const pkId = req.authenticatedUser.pkId;
    const privilegeId = req.privilege?.pkId;

    try {
        const devices = await prisma.device.findMany({
            where: accessibleDeviceWhere(pkId, privilegeId),
            include: {
                DeviceLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
                // 🆕 Include sessions untuk validasi
                sessions: {
                    where: { id: { contains: 'config' } },
                    select: { sessionId: true }
                },
                _count: { select: { assignments: true } },
            },
        });

        // Runtime state is the source of truth. Keep this endpoint read-only so
        // a request during startup cannot overwrite a session being restored.
        const validatedDevices = devices.map((device) => {
            const sessionId = device.sessions[0]?.sessionId;
            const canManage = device.userId === pkId;
            const hasInstance = Boolean(sessionId && verifyInstance(sessionId));
            const status = deriveDeviceRuntimeStatus({
                databaseStatus: device.status,
                hasSession: Boolean(sessionId),
                hasInstance,
                connection: sessionId ? getConnectionStatus(sessionId) : undefined,
                reconnecting: sessionId ? isReconnecting(sessionId) : false,
            });

            // Remove sessions array but preserve sessionId field for socket listeners
            const { sessions, ...deviceWithoutSessions } = device;
            return {
                ...deviceWithoutSessions,
                isOwner: device.userId === pkId,
                accessType: device.userId === pkId ? 'owner' : 'assigned',
                canManage,
                assignmentCount: device._count.assignments,
                status,
                sessionId: sessions[0]?.sessionId || null // ✅ Include sessionId for frontend socket listeners
            };
        });

        res.status(200).json(validatedDevices);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getDeviceLabels: RequestHandler = async (req, res) => {
    const pkId = req.authenticatedUser.pkId;

    try {
        const labels = await prisma.label.findMany({
            where: {
                DeviceLabel: {
                    some: { device: accessibleDeviceWhere(pkId, req.privilege?.pkId) },
                },
            },
        });

        res.status(200).json(labels.map((label) => label.name));
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const generateApiKeyDevice: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const userPkId = req.authenticatedUser.pkId;
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...ownedDeviceWhere(userPkId, req.privilege?.pkId),
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // Generate plain API key for user, hash for storage
        const plainApiKey = generateUuid();
        const hashedApiKey = hashApiKey(plainApiKey);

        await prisma.device.update({
            where: { pkId: device.pkId },
            data: {
                apiKey: hashedApiKey, // Store hashed version
            },
        });
        
        // Return plain key to user (only time they'll see it)
        res.status(200).json({ apiKey: plainApiKey });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createDevice: RequestHandler = async (req, res) => {
    const { name, labels } = req.body;
    const apiKey = generateUuid();
    const pkId = req.authenticatedUser.pkId;
    const subscription = req.subscription;

    try {
        await prisma.$transaction(async (transaction) => {
            const createdDevice = await transaction.device.create({
                data: {
                    apiKey,
                    name,
                    user: { connect: { pkId } },
                },
            });

            await useDevice(transaction, subscription);

            if (labels && labels.length > 0) {
                const labelIds: number[] = [];

                for (const labelName of labels) {
                    const slug = generateSlug(labelName);
                    const createdLabel = await transaction.label.upsert({
                        where: {
                            slug,
                        },
                        create: {
                            name: labelName,
                            slug,
                        },
                        update: {
                            name: labelName,
                            slug,
                        },
                    });

                    labelIds.push(createdLabel.pkId);
                }

                await transaction.deviceLabel.createMany({
                    data: labelIds.map((labelId) => ({
                        deviceId: createdDevice.pkId,
                        labelId: labelId,
                    })),
                    skipDuplicates: true,
                });
            }
            res.status(201).json({ message: 'Device created successfully', data: createdDevice });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getDevice: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const userPkId = req.authenticatedUser.pkId;
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...accessibleDeviceWhere(userPkId, req.privilege?.pkId),
            },
            include: {
                sessions: { where: { id: { contains: 'config' } }, select: { sessionId: true } },
                DeviceLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
                DeviceLog: true,
            },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        res.status(200).json(device);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateDevice: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        const { name, labels } = req.body;

        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        await prisma.$transaction(async (transaction) => {
            const existingDevice = await transaction.device.findFirst({
                where: {
                    id: deviceId,
                    ...ownedDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
                },
            });

            if (!existingDevice) {
                return res.status(404).json({ message: 'Device not found' });
            }

            const updatedDevice = await transaction.device.update({
                where: {
                    pkId: existingDevice.pkId,
                },
                data: {
                    name,
                    updatedAt: new Date(),
                },
            });

            if (labels && labels.length > 0) {
                const labelIds: number[] = [];
                const slugs = labels.map((slug: string) => generateSlug(slug));

                await transaction.label.deleteMany({
                    where: {
                        DeviceLabel: {
                            some: {
                                deviceId: updatedDevice.pkId,
                            },
                        },
                        NOT: {
                            slug: {
                                in: slugs,
                            },
                        },
                    },
                });

                for (const labelName of labels) {
                    const slug = generateSlug(labelName);
                    const existingLabel = await transaction.label.upsert({
                        where: {
                            slug,
                        },
                        create: {
                            name: labelName,
                            slug,
                        },
                        update: {
                            name: labelName,
                            slug,
                        },
                    });

                    labelIds.push(existingLabel.pkId);
                }

                await transaction.deviceLabel.deleteMany({
                    where: {
                        deviceId: updatedDevice.pkId,
                    },
                });

                await transaction.deviceLabel.createMany({
                    data: labelIds.map((labelId) => ({
                        deviceId: updatedDevice.pkId,
                        labelId,
                    })),
                    skipDuplicates: true,
                });
            } else {
                await transaction.label.deleteMany({
                    where: {
                        DeviceLabel: {
                            some: {
                                deviceId: updatedDevice.pkId,
                            },
                        },
                    },
                });
            }
        });
        res.status(200).json({ message: 'Device updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const logoutDevice: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...ownedDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            include: {
                sessions: {
                    select: { sessionId: true },
                },
            },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const sessionIds = [
            ...new Set(
                device.sessions
                    .map((session) => String(session.sessionId || '').trim())
                    .filter(Boolean),
            ),
        ];
        if (sessionIds.length > 0) {
            markManualLogout(device.pkId);
        }

        const logoutResults = await Promise.all(
            sessionIds.map((sessionId) => logoutDeviceSession(sessionId, device.pkId)),
        );
        const remoteLogoutConfirmed =
            sessionIds.length > 0 && logoutResults.every((result) => result.logoutSucceeded);

        const failures = logoutResults.flatMap((result) => result.failures || []);
        if (sessionIds.length > 0 && !remoteLogoutConfirmed) {
            clearManualLogout(device.pkId);
            logger.warn(
                { deviceId, devicePkId: device.pkId, sessionIds, failures },
                'Remote WhatsApp logout failed; retaining local credentials',
            );
            return res.status(502).json({
                message:
                    'WhatsApp belum mengonfirmasi logout. Session lokal tetap disimpan agar dapat dicoba kembali.',
                remoteLogoutConfirmed: false,
                localSessionCleared: false,
                retryable: true,
                failures,
            });
        }

        // Credentials are only removed after WhatsApp acknowledges the remote
        // unlink. The device and application data remain available for pairing.
        await prisma.$transaction([
            prisma.session.deleteMany({ where: { deviceId: device.pkId } }),
            prisma.device.update({
                where: { pkId: device.pkId },
                data: { status: 'close', updatedAt: new Date() },
            }),
        ]);

        logger.info(
            {
                deviceId,
                devicePkId: device.pkId,
                sessionIds,
                remoteLogoutConfirmed,
                failures,
            },
            'Device WhatsApp logout completed',
        );

        return res.status(200).json({
            message: remoteLogoutConfirmed
                ? 'WhatsApp berhasil logout. Device dan data aplikasi tetap disimpan.'
                : sessionIds.length === 0
                  ? 'Device sudah tidak memiliki session WhatsApp aktif.'
                  : 'Session lokal berhasil dibersihkan, tetapi logout pada WhatsApp tidak dapat dikonfirmasi.',
            remoteLogoutConfirmed,
            localSessionCleared: true,
        });
    } catch (error) {
        logger.error({ error, deviceId: req.params.deviceId }, 'Failed to logout WhatsApp device');
        return res.status(500).json({ message: 'Gagal logout WhatsApp' });
    }
};

export const deleteDevices: RequestHandler = async (req, res) => {
    try {
        const deviceIds = req.body.deviceIds;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
            return res.status(400).json({ message: 'Invalid deviceIds' });
        }

        const devicePromises = deviceIds.map(async (deviceId: string) => {
            // Verify ownership before deletion
            const device = await prisma.device.findFirst({
                where: {
                    id: deviceId,
                    ...ownedDeviceWhere(userId, privilegeId),
                },
                include: {
                    sessions: {
                        select: { sessionId: true },
                    },
                },
            });

            if (!device) {
                return { success: false, deviceId, reason: 'not_found' as const };
            }

            // Unlink the companion device before deleting its credentials. If
            // WhatsApp cannot acknowledge the request, retain the device so the
            // user can retry instead of leaving a ghost linked device behind.
            const sessionIds = [
                ...new Set(
                    device.sessions
                        .map((session) => String(session.sessionId || '').trim())
                        .filter(Boolean),
                ),
            ];
            if (sessionIds.length > 0) {
                markManualLogout(device.pkId);
                const logoutResults = await Promise.all(
                    sessionIds.map((sessionId) => logoutDeviceSession(sessionId, device.pkId)),
                );
                if (logoutResults.some((result) => !result.logoutSucceeded)) {
                    clearManualLogout(device.pkId);
                    return {
                        success: false,
                        deviceId,
                        reason: 'logout_failed' as const,
                    };
                }
            }

            // Delete device (cascade delete will handle WhatsApp groups automatically)
            const deletedDevice = await prisma.device.delete({
                where: {
                    id: deviceId,
                },
            });

            // Clean up related data
            await Promise.all([
                prisma.contact.deleteMany({
                    where: {
                        contactDevices: { some: { device: { id: deviceId } } },
                    },
                }),
                // Only delete labels that are orphaned (not used in ANY DeviceLabel OR ContactLabel)
                prisma.label.deleteMany({
                    where: {
                        AND: [
                            {
                                // No DeviceLabel relationships exist
                                DeviceLabel: {
                                    none: {}
                                }
                            },
                            {
                                // No ContactLabel relationships exist
                                ContactLabel: {
                                    none: {}
                                }
                            }
                        ]
                    },
                })
            ]);

            // Clean up media directory
            const subDirectoryPath = `media/D${deviceId}`;
            fs.rm(subDirectoryPath, { recursive: true }, (err) => {
                if (err) {
                    console.error(`Error deleting sub-directory: ${err}`);
                } else {
                    // console.log(`Sub-directory ${subDirectoryPath} is deleted successfully.`);
                }
            });

            // console.log(`Successfully deleted device: ${deviceId}`);
            return { success: true, deviceId, reason: null };
        });

        const deviceResults = await Promise.all(devicePromises);
        const logoutFailedDeviceIds = deviceResults
            .filter((result) => !result.success && result.reason === 'logout_failed')
            .map((result) => result.deviceId);
        if (logoutFailedDeviceIds.length > 0) {
            return res.status(502).json({
                message:
                    'Device belum dihapus karena WhatsApp belum mengonfirmasi logout. Silakan coba kembali.',
                deviceIds: logoutFailedDeviceIds,
            });
        }

        const hasFailures = deviceResults.some((result) => !result.success);
        
        if (hasFailures) {
            const failedDeviceIds = deviceResults
                .filter((result) => !result.success)
                .map((result) => result.deviceId);
            return res
                .status(404)
                .json({ message: `Devices not found: ${failedDeviceIds.join(', ')}` });
        }

        res.status(200).json({ message: 'Device(s) deleted successfully' });
    } catch (error) {
        logger.error('Error in deleteDevices:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const issueDeviceAccessToken: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;
        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const userPkId = req.authenticatedUser.pkId;

        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...accessibleDeviceWhere(userPkId, req.privilege?.pkId),
            },
            select: { id: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const token = generateDeviceAccessToken({
            deviceId: device.id,
            userId: userPkId,
            purpose: 'device-api',
        });

        res.status(200).json({ token, expiresIn: process.env.DEVICE_ACCESS_TOKEN_TTL || '2m' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// ============================================
// Device Health Monitoring Endpoints
// ============================================

/**
 * Get device health status and recent signals
 * GET /devices/:id/health
 */
export const getDeviceHealthStatus: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.id;

        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid device ID' });
        }

        // Verify device belongs to user
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...accessibleDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            select: {
                pkId: true,
                status: true,
                sessions: {
                    where: { id: { contains: 'config' } },
                    select: { sessionId: true },
                },
            },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const health = await getDeviceHealth(deviceId);

        if (!health) {
            return res.status(404).json({ message: 'Device health info not found' });
        }

        const connectionStatus = getRuntimeDeviceStatus(device);
        const hasSession = Boolean(device.sessions[0]?.sessionId);
        const requiresPairing = connectionStatus === 'logged_out'
            || (connectionStatus === 'close' && !hasSession);
        const connectionRecommendation = requiresPairing
            ? 'Sesi WhatsApp tidak aktif. Lakukan pairing ulang sebelum mengirim pesan.'
            : connectionStatus === 'close'
                ? 'Koneksi WhatsApp sedang terputus. Tunggu proses reconnect atau periksa jaringan.'
                : connectionStatus === 'reconnecting' || connectionStatus === 'connecting'
                    ? 'WhatsApp sedang menghubungkan ulang. Tunggu hingga status Terhubung.'
                    : null;

        // Add convenience fields for frontend
        res.status(200).json({
            ...health,
            connectionStatus,
            isConnected: connectionStatus === 'open',
            requiresPairing,
            isPaused: health.healthStatus === 'paused',
            todayMessages: health.todayMessageCount,
            recentRateLimits: health.stats?.rateLimitCount24h || 0,
            recentErrors: health.stats?.errorCount24h || 0,
            // Kept for clients that still use the old response field.
            recentConnectionErrors: health.stats?.errorCount24h || 0,
            recommendations: connectionRecommendation
                ? [connectionRecommendation]
                : health.recommendation
                    ? [health.recommendation]
                    : [],
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Pause a device manually
 * POST /devices/:id/pause
 */
export const pauseDeviceManually: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.id;
        const { reason, durationMinutes } = req.body;

        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid device ID' });
        }

        // Validate durationMinutes (0-1440 minutes = 0-24 hours)
        if (durationMinutes !== undefined) {
            const duration = Number(durationMinutes);
            if (isNaN(duration) || duration < 0 || duration > 1440) {
                return res.status(400).json({ 
                    message: 'Invalid durationMinutes. Must be a number between 0 and 1440 (24 hours)' 
                });
            }
        }

        // Verify device belongs to user
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...ownedDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            select: {
                pkId: true,
                healthStatus: true,
                status: true,
                sessions: {
                    where: { id: { contains: 'config' } },
                    select: { sessionId: true },
                },
            },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        if (device.healthStatus === 'banned') {
            return res.status(400).json({ message: 'Device is banned and cannot be paused' });
        }

        if (getRuntimeDeviceStatus(device) !== 'open') {
            return res.status(409).json({
                message: 'Device belum terhubung. Hubungkan atau pairing ulang sebelum menjeda pengiriman.',
            });
        }

        const durationMs = durationMinutes ? Number(durationMinutes) * 60 * 1000 : 0;
        const pauseReason = reason || 'Manual pause oleh user';

        await pauseDevice(device.pkId, pauseReason, durationMs);

        res.status(200).json({ 
            message: 'Device paused successfully',
            resumeAt: durationMs > 0 ? new Date(Date.now() + durationMs) : null,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Resume a paused device
 * POST /devices/:id/resume
 */
export const resumeDeviceManually: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.id;

        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid device ID' });
        }

        // Verify device belongs to user
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...ownedDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            select: {
                pkId: true,
                healthStatus: true,
                status: true,
                sessions: {
                    where: { id: { contains: 'config' } },
                    select: { sessionId: true },
                },
            },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        if (device.healthStatus === 'banned') {
            return res.status(400).json({ 
                message: 'Device terdeteksi banned oleh WhatsApp. Tidak dapat di-resume.',
            });
        }

        if (device.healthStatus !== 'paused') {
            return res.status(400).json({ message: 'Device is not paused' });
        }

        if (getRuntimeDeviceStatus(device) !== 'open') {
            return res.status(409).json({
                message: 'Sesi WhatsApp belum terhubung. Lakukan pairing ulang sebelum resume.',
            });
        }

        await resumeDevice(device.pkId);

        res.status(200).json({ message: 'Device resumed successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Get signal history for a device
 * GET /devices/:id/signals
 */
export const getDeviceSignals: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.id;
        const limit = parseInt(req.query.limit as string) || 50;
        const page = parseInt(req.query.page as string) || 1;

        if (!isUUID(deviceId)) {
            return res.status(400).json({ message: 'Invalid device ID' });
        }

        // Verify device belongs to user
        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...accessibleDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const [signals, total] = await Promise.all([
            prisma.deviceSignal.findMany({
                where: { deviceId: device.pkId },
                orderBy: { createdAt: 'desc' },
                skip: (page - 1) * limit,
                take: limit,
                select: {
                    id: true,
                    signalType: true,
                    code: true,
                    message: true,
                    severity: true,
                    confidence: true,
                    action: true,
                    createdAt: true,
                },
            }),
            prisma.deviceSignal.count({
                where: { deviceId: device.pkId },
            }),
        ]);

        res.status(200).json({
            signals,
            pagination: {
                page,
                limit,
                total,
                totalPages: Math.ceil(total / limit),
            },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// ============================================
// SCHEDULED JOBS
// Store references for graceful shutdown cleanup
// ============================================

const scheduledJobs: schedule.Job[] = [];

// Batch size for paginated cleanup queries
const CLEANUP_BATCH_SIZE = 1000;

/**
 * Cleanup orphaned labels and contacts using cursor-based pagination
 * Prevents memory spikes with large datasets
 */
async function cleanupOrphanedData(): Promise<void> {
    const validLabelIds = new Set<number>();
    const validContactIds = new Set<number>();

    // Collect valid label IDs from deviceLabels with pagination
    let labelCursor: number | undefined;
    while (true) {
        const batch = await prisma.deviceLabel.findMany({
            take: CLEANUP_BATCH_SIZE,
            skip: labelCursor ? 1 : 0,
            cursor: labelCursor ? { pkId: labelCursor } : undefined,
            select: { pkId: true, labelId: true },
            orderBy: { pkId: 'asc' },
        });
        if (batch.length === 0) break;
        batch.forEach((item) => validLabelIds.add(item.labelId));
        labelCursor = batch[batch.length - 1].pkId;
        if (batch.length < CLEANUP_BATCH_SIZE) break;
    }

    // Collect valid label IDs from contactLabels with pagination
    // Note: ContactLabel uses 'id' field instead of 'pkId'
    let contactLabelCursor: number | undefined;
    while (true) {
        const batch = await prisma.contactLabel.findMany({
            take: CLEANUP_BATCH_SIZE,
            skip: contactLabelCursor ? 1 : 0,
            cursor: contactLabelCursor ? { id: contactLabelCursor } : undefined,
            select: { id: true, labelId: true },
            orderBy: { id: 'asc' },
        });
        if (batch.length === 0) break;
        batch.forEach((item) => validLabelIds.add(item.labelId));
        contactLabelCursor = batch[batch.length - 1].id;
        if (batch.length < CLEANUP_BATCH_SIZE) break;
    }

    // Collect valid contact IDs from contactDevices with pagination
    let contactDeviceCursor: number | undefined;
    while (true) {
        const batch = await prisma.contactDevice.findMany({
            take: CLEANUP_BATCH_SIZE,
            skip: contactDeviceCursor ? 1 : 0,
            cursor: contactDeviceCursor ? { pkId: contactDeviceCursor } : undefined,
            select: { pkId: true, contactId: true },
            orderBy: { pkId: 'asc' },
        });
        if (batch.length === 0) break;
        batch.forEach((item) => validContactIds.add(item.contactId));
        contactDeviceCursor = batch[batch.length - 1].pkId;
        if (batch.length < CLEANUP_BATCH_SIZE) break;
    }

    // Collect valid contact IDs from contactGroups with pagination
    let contactGroupCursor: number | undefined;
    while (true) {
        const batch = await prisma.contactGroup.findMany({
            take: CLEANUP_BATCH_SIZE,
            skip: contactGroupCursor ? 1 : 0,
            cursor: contactGroupCursor ? { pkId: contactGroupCursor } : undefined,
            select: { pkId: true, contactId: true },
            orderBy: { pkId: 'asc' },
        });
        if (batch.length === 0) break;
        batch.forEach((item) => validContactIds.add(item.contactId));
        contactGroupCursor = batch[batch.length - 1].pkId;
        if (batch.length < CLEANUP_BATCH_SIZE) break;
    }

    // Delete orphaned labels in batches
    let deletedLabels = 0;
    while (true) {
        const orphanedLabels = await prisma.label.findMany({
            where: { pkId: { notIn: Array.from(validLabelIds) } },
            take: CLEANUP_BATCH_SIZE,
            select: { pkId: true },
        });
        if (orphanedLabels.length === 0) break;
        await prisma.label.deleteMany({
            where: { pkId: { in: orphanedLabels.map((l) => l.pkId) } },
        });
        deletedLabels += orphanedLabels.length;
        // Yield to event loop
        await new Promise((resolve) => setImmediate(resolve));
    }

    // Delete orphaned contacts in batches
    let deletedContacts = 0;
    while (true) {
        const orphanedContacts = await prisma.contact.findMany({
            where: { pkId: { notIn: Array.from(validContactIds) } },
            take: CLEANUP_BATCH_SIZE,
            select: { pkId: true },
        });
        if (orphanedContacts.length === 0) break;
        await prisma.contact.deleteMany({
            where: { pkId: { in: orphanedContacts.map((c) => c.pkId) } },
        });
        deletedContacts += orphanedContacts.length;
        // Yield to event loop
        await new Promise((resolve) => setImmediate(resolve));
    }

    if (deletedLabels > 0 || deletedContacts > 0) {
        logger.info({ deletedLabels, deletedContacts }, 'Database cleanup completed');
    }
}

// Database cleanup job - DISABLED to prevent accidental data deletion
// Issue: When validLabelIds is empty (e.g., DB connection issue at startup),
// notIn: [] would delete ALL labels, causing cascade deletion of ContactLabel.
// This happened on 26-27 Dec 2025.
// 
// scheduledJobs.push(
//     schedule.scheduleJob('*/5 * * * *', async () => {
//         try {
//             await cleanupOrphanedData();
//         } catch (error) {
//             logger.error('Error executing database cleanup:', error);
//         }
//     })
// );

// Auto-resume paused devices (every 5 minutes)
scheduledJobs.push(
    schedule.scheduleJob('*/5 * * * *', async () => {
        try {
            await checkAutoResume();
        } catch (error) {
            logger.error('Error checking auto-resume:', error);
        }
    })
);

// Cleanup old signals (once per day at 3 AM)
scheduledJobs.push(
    schedule.scheduleJob('0 3 * * *', async () => {
        try {
            await cleanupOldSignals();
        } catch (error) {
            logger.error('Error cleaning up old signals:', error);
        }
    })
);

/**
 * Delete a specific conversation (all messages from a specific sender) for a device
 * DELETE /devices/:deviceId/inbox/conversation
 * Body: { from: string } - the JID of the sender
 */
export const deleteConversation: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        if (!isUUID(deviceUuid)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const { from } = req.body;
        if (!from || typeof from !== 'string') {
            return res.status(400).json({ message: 'Missing or invalid "from" field' });
        }

        const userPkId = req.authenticatedUser.pkId;
        const device = await prisma.device.findFirst({
            where: { id: deviceUuid, ...accessibleDeviceWhere(userPkId, req.privilege?.pkId) },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const [incomingMedia, outgoingMedia] = await Promise.all([
            prisma.incomingMessage.findMany({
                where: { deviceId: device.pkId, from, mediaPath: { not: null } },
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
            prisma.outgoingMessage.findMany({
                where: { deviceId: device.pkId, to: from, mediaPath: { not: null } },
                select: { mediaPath: true },
                distinct: ['mediaPath'],
            }),
        ]);

        const [incomingResult, outgoingResult] = await prisma.$transaction([
            prisma.incomingMessage.deleteMany({
                where: {
                    deviceId: device.pkId,
                    from,
                },
            }),
            prisma.outgoingMessage.deleteMany({
                where: {
                    deviceId: device.pkId,
                    to: from,
                },
            }),
        ]);
        await deleteConversationReactions(device.pkId, from).catch((error) => {
            logger.warn(
                { code: (error as { code?: unknown })?.code },
                'Failed to delete conversation reaction metadata',
            );
        });
        await deleteConversationPolls(device.pkId, from).catch((error) => {
            logger.warn(
                { code: (error as { code?: unknown })?.code },
                'Failed to delete conversation poll metadata',
            );
        });
        const mediaCleanup = await cleanupMediaFilesIfUnreferenced(
            [...incomingMedia, ...outgoingMedia].map((item) => item.mediaPath),
            'delete-inbox-conversation',
        );

        const deletedCount = incomingResult.count + outgoingResult.count;

        res.status(200).json({
            message: `Berhasil menghapus ${deletedCount} pesan`,
            deletedCount,
            deletedIncomingCount: incomingResult.count,
            deletedOutgoingCount: outgoingResult.count,
            mediaDeletedCount: mediaCleanup.deleted,
            mediaRetainedCount: mediaCleanup.referenced,
            mediaDeleteFailedCount: mediaCleanup.failed,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Mark all messages from a specific sender as read
 * PUT /devices/:deviceId/inbox/conversation/read
 * Body: { from: string } - the JID of the sender
 */
export const markConversationAsRead: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        if (!isUUID(deviceUuid)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const { from } = req.body;
        if (!from || typeof from !== 'string') {
            return res.status(400).json({ message: 'Missing or invalid "from" field' });
        }

        const userPkId = req.authenticatedUser.pkId;
        const device = await prisma.device.findFirst({
            where: { id: deviceUuid, ...accessibleDeviceWhere(userPkId, req.privilege?.pkId) },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const result = await prisma.incomingMessage.updateMany({
            where: {
                deviceId: device.pkId,
                from: from,
                isRead: false,
            },
            data: {
                isRead: true,
                updatedAt: new Date(),
            },
        });

        res.status(200).json({
            message: `Berhasil menandai ${result.count} pesan sebagai sudah dibaca`,
            updatedCount: result.count,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Delete all incoming messages for a device
 * DELETE /devices/:deviceId/inbox
 */
export const deleteAllInbox: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        if (!isUUID(deviceUuid)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const userPkId = req.authenticatedUser.pkId;
        const device = await prisma.device.findFirst({
            where: { id: deviceUuid, ...accessibleDeviceWhere(userPkId, req.privilege?.pkId) },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const [incomingResult, outgoingResult] = await prisma.$transaction([
            prisma.incomingMessage.deleteMany({
                where: { deviceId: device.pkId },
            }),
            prisma.outgoingMessage.deleteMany({
                where: { deviceId: device.pkId },
            }),
        ]);
        await deleteAllDeviceReactions(device.pkId).catch((error) => {
            logger.warn(
                { code: (error as { code?: unknown })?.code },
                'Failed to delete device reaction metadata',
            );
        });
        await deleteAllDevicePolls(device.pkId).catch((error) => {
            logger.warn(
                { code: (error as { code?: unknown })?.code },
                'Failed to delete device poll metadata',
            );
        });

        const deletedCount = incomingResult.count + outgoingResult.count;

        res.status(200).json({
            message: `Berhasil menghapus seluruh ${deletedCount} pesan masuk dan keluar`,
            deletedCount,
            deletedIncomingCount: incomingResult.count,
            deletedOutgoingCount: outgoingResult.count,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Get outgoing messages (outbox) for a device
 * GET /devices/:deviceId/outbox?to=<jid>&limit=50
 */
export const getDeviceOutbox: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        if (!isUUID(deviceUuid)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const { to, limit = '30', before } = req.query;
        const userPkId = req.authenticatedUser.pkId;

        const device = await prisma.device.findFirst({
            where: { id: deviceUuid, ...accessibleDeviceWhere(userPkId, req.privilege?.pkId) },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        // Build where clause
        const where: any = {
            deviceId: device.pkId,
            inboxHiddenAt: null,
        };

        // Filter by recipient if provided
        if (to && typeof to === 'string') {
            where.to = to;
        }
        if (typeof before === 'string' && before.trim()) {
            const beforeDate = new Date(before);
            if (Number.isNaN(beforeDate.getTime())) {
                return res.status(400).json({ message: 'Invalid before cursor' });
            }
            where.createdAt = { lt: beforeDate };
        }

        // Fetch outgoing messages
        const messages = await prisma.outgoingMessage.findMany({
            where,
            orderBy: { createdAt: 'desc' }, // ✅ DESC untuk ambil yang TERBARU dulu
            take: Math.min(50, Math.max(1, parseInt(limit as string) || 30)),
            select: {
                id: true,
                waMessageId: true,
                to: true,
                message: true,
                mediaPath: true,
                fileName: true,
                status: true,
                createdAt: true,
                isGroup: true,
                readBy: true,
            },
        });

        // ✅ CRITICAL: Decrypt messages before sending to frontend
        const { decryptOutgoingMessages } = await import('../utils/messageEncryption');
        const decryptedMessages = decryptOutgoingMessages(messages).map((message) => ({
            ...message,
            mediaType: resolveInboxMediaType(
                message.mediaPath,
                message.fileName,
                message.message,
            ),
            mediaPath: serializeInboxMediaPath(message.mediaPath, deviceUuid, message.id),
        }));

        // ✅ CRITICAL: Disable ETag caching for this endpoint
        // Pesan baru harus selalu di-fetch dari database, tidak boleh di-cache
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.removeHeader('ETag');

        res.status(200).json(decryptedMessages);
    } catch (error) {
        logger.error('Error in getDeviceOutbox:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

type ConversationTimelineRow = {
    sourcePkId: number;
    id: string;
    direction: 'incoming' | 'outgoing';
    directionOrder: number;
    conversationJid: string;
    message: string | null;
    mediaPath: string | null;
    fileName: string | null;
    timestamp: Date;
    editedAt: Date | null;
    quotedMessageId: string | null;
    quotedFromMe: boolean | null;
    quotedText: string | null;
    quotedSender: string | null;
    status: string | null;
    isRead: boolean | null;
    isGroup: boolean;
    participant: string | null;
    pushName: string | null;
    groupName: string | null;
    waMessageId: string | null;
    readBy: unknown;
    readReceipts: unknown;
};

type ConversationTimelineCursor = {
    timestamp: Date;
    directionOrder: number;
    sourcePkId: number;
};

function encodeConversationTimelineCursor(row: ConversationTimelineRow): string {
    return Buffer.from(
        JSON.stringify({
            timestamp: row.timestamp.toISOString(),
            directionOrder: row.directionOrder,
            sourcePkId: row.sourcePkId,
        }),
    ).toString('base64url');
}

function decodeConversationTimelineCursor(value: unknown): ConversationTimelineCursor | null {
    if (typeof value !== 'string' || !value.trim()) return null;
    try {
        const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
        const timestamp = new Date(parsed.timestamp);
        const directionOrder = Number(parsed.directionOrder);
        const sourcePkId = Number(parsed.sourcePkId);
        if (
            Number.isNaN(timestamp.getTime())
            || ![0, 1].includes(directionOrder)
            || !Number.isSafeInteger(sourcePkId)
            || sourcePkId < 1
        ) {
            return null;
        }
        return { timestamp, directionOrder, sourcePkId };
    } catch {
        return null;
    }
}

/**
 * Get one cursor-paginated timeline containing both incoming and outgoing
 * messages. The browser no longer has to merge two independently paginated
 * windows, which guarantees that the final item is the actual latest message.
 * GET /devices/:deviceId/inbox/timeline?conversationJid=<jid>&limit=30&before=<cursor>
 */
export const getDeviceConversationTimeline: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        const conversationJid = typeof req.query.conversationJid === 'string'
            ? req.query.conversationJid.trim()
            : '';
        if (!isUUID(deviceUuid) || !conversationJid) {
            return res.status(400).json({ message: 'Invalid deviceId or conversationJid' });
        }

        const requestedLimit = Math.min(50, Math.max(1, Number(req.query.limit) || 30));
        const hasCursor = typeof req.query.before === 'string' && Boolean(req.query.before.trim());
        const cursor = decodeConversationTimelineCursor(req.query.before);
        if (hasCursor && !cursor) {
            return res.status(400).json({ message: 'Invalid timeline cursor' });
        }

        const device = await prisma.device.findFirst({
            where: {
                id: deviceUuid,
                ...accessibleDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            select: {
                pkId: true,
                phone: true,
                sessions: {
                    where: { id: { contains: 'config' } },
                    select: { sessionId: true },
                    orderBy: { pkId: 'desc' },
                    take: 1,
                },
            },
        });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const cursorFilter = cursor
            ? Prisma.sql`WHERE ("timestamp", "directionOrder", "sourcePkId") < (${cursor.timestamp}, ${cursor.directionOrder}, ${cursor.sourcePkId})`
            : Prisma.empty;
        const rows = await prisma.$queryRaw<ConversationTimelineRow[]>(Prisma.sql`
            SELECT *
            FROM (
                SELECT
                    incoming."pkId" AS "sourcePkId",
                    incoming."id" AS "id",
                    'incoming'::TEXT AS "direction",
                    0::INTEGER AS "directionOrder",
                    incoming."from" AS "conversationJid",
                    incoming."message" AS "message",
                    incoming."mediaPath" AS "mediaPath",
                    incoming."file_name" AS "fileName",
                    incoming."received_at" AS "timestamp",
                    incoming."edited_at" AS "editedAt",
                    incoming."quoted_message_id" AS "quotedMessageId",
                    incoming."quoted_from_me" AS "quotedFromMe",
                    incoming."quoted_text" AS "quotedText",
                    incoming."quoted_sender" AS "quotedSender",
                    NULL::TEXT AS "status",
                    incoming."is_read" AS "isRead",
                    (incoming."from" LIKE '%@g.us') AS "isGroup",
                    incoming."participant" AS "participant",
                    incoming."push_name" AS "pushName",
                    incoming."group_name" AS "groupName",
                    NULL::TEXT AS "waMessageId",
                    NULL::JSONB AS "readBy",
                    NULL::JSONB AS "readReceipts"
                FROM "IncomingMessage" incoming
                WHERE incoming."device_id" = ${device.pkId}
                  AND incoming."from" = ${conversationJid}
                  AND incoming."inbox_hidden_at" IS NULL

                UNION ALL

                SELECT
                    outgoing."pkId" AS "sourcePkId",
                    outgoing."id" AS "id",
                    'outgoing'::TEXT AS "direction",
                    1::INTEGER AS "directionOrder",
                    outgoing."to" AS "conversationJid",
                    outgoing."message" AS "message",
                    outgoing."mediaPath" AS "mediaPath",
                    outgoing."file_name" AS "fileName",
                    outgoing."created_at" AS "timestamp",
                    outgoing."edited_at" AS "editedAt",
                    outgoing."quoted_message_id" AS "quotedMessageId",
                    outgoing."quoted_from_me" AS "quotedFromMe",
                    outgoing."quoted_text" AS "quotedText",
                    outgoing."quoted_sender" AS "quotedSender",
                    outgoing."status" AS "status",
                    NULL::BOOLEAN AS "isRead",
                    COALESCE(outgoing."isGroup", false) OR (outgoing."to" LIKE '%@g.us') AS "isGroup",
                    NULL::TEXT AS "participant",
                    NULL::TEXT AS "pushName",
                    NULL::TEXT AS "groupName",
                    outgoing."wa_message_id" AS "waMessageId",
                    outgoing."read_by" AS "readBy",
                    outgoing."read_receipts" AS "readReceipts"
                FROM "OutgoingMessage" outgoing
                WHERE outgoing."device_id" = ${device.pkId}
                  AND outgoing."to" = ${conversationJid}
                  AND outgoing."inbox_hidden_at" IS NULL
            ) timeline
            ${cursorFilter}
            ORDER BY "timestamp" DESC, "directionOrder" DESC, "sourcePkId" DESC
            LIMIT ${requestedLimit + 1}
        `);

        const hasMore = rows.length > requestedLimit;
        const page = rows.slice(0, requestedLimit);
        const ownIdentityJids = getOwnIdentityJids(
            device.phone,
            device.sessions[0]?.sessionId,
        );
        const nextCursor = hasMore && page.length > 0
            ? encodeConversationTimelineCursor(page[page.length - 1])
            : null;
        const quotedMessageIds = [
            ...new Set(
                page
                    .map((row) => row.quotedMessageId)
                    .filter((id): id is string => Boolean(id)),
            ),
        ];
        const senderJids = [
            ...new Set(
                page
                    .filter((row) => row.direction === 'incoming' && row.isGroup)
                    .map((row) => row.participant)
                    .filter((jid): jid is string => Boolean(
                        jid
                        && !jid.endsWith('@lid')
                        && !jid.endsWith('@g.us'),
                    )),
            ),
        ];
        const senderPhones = [
            ...new Set(
                senderJids
                    .map((jid) => jid.split('@')[0].split(':')[0].replace(/\D/g, ''))
                    .filter(Boolean),
            ),
        ];
        const [
            senderProfileCache,
            senderContacts,
            quotedIncomingMessages,
            quotedOutgoingMessages,
            pollStatesByMessageId,
        ] =
            await Promise.all([
                getInboxProfileCacheSummaries(device.pkId, senderJids),
                senderPhones.length > 0
                    ? prisma.contact.findMany({
                          where: {
                              phone: {
                                  in: [
                                      ...senderPhones,
                                      ...senderPhones.map((phone) => `+${phone}`),
                                  ],
                              },
                              contactDevices: { some: { deviceId: device.pkId } },
                          },
                          select: inboxContactSelect,
                      })
                    : Promise.resolve([]),
                quotedMessageIds.length > 0
                    ? prisma.incomingMessage.findMany({
                          where: {
                              deviceId: device.pkId,
                              id: { in: quotedMessageIds },
                          },
                          select: {
                              id: true,
                              from: true,
                              participant: true,
                              pushName: true,
                              mediaPath: true,
                              fileName: true,
                              message: true,
                              contact: {
                                  select: { firstName: true, lastName: true },
                              },
                              editSecret: {
                                  select: { senderJid: true, senderAltJid: true },
                              },
                          },
                      })
                    : Promise.resolve([]),
                quotedMessageIds.length > 0
                    ? prisma.outgoingMessage.findMany({
                          where: {
                              deviceId: device.pkId,
                              OR: [
                                  { id: { in: quotedMessageIds } },
                                  { waMessageId: { in: quotedMessageIds } },
                              ],
                          },
                          select: {
                              id: true,
                              waMessageId: true,
                              mediaPath: true,
                              fileName: true,
                              message: true,
                          },
                      })
                    : Promise.resolve([]),
                getMessagePollStates(device.pkId, page.map((row) => row.id)),
            ]);
        const quotedSenderPhones = [
            ...new Set(
                quotedIncomingMessages
                    .map((message) => [
                        message.editSecret?.senderJid,
                        message.editSecret?.senderAltJid,
                        message.participant,
                        message.from,
                    ].map(phoneFromWhatsAppJid).find(Boolean))
                    .filter((phone): phone is string => Boolean(phone)),
            ),
        ];
        const missingQuotedSenderPhones = quotedSenderPhones.filter(
            (phone) => !senderPhones.includes(phone),
        );
        const quotedSenderContacts = missingQuotedSenderPhones.length > 0
            ? await prisma.contact.findMany({
                  where: {
                      phone: {
                          in: [
                              ...missingQuotedSenderPhones,
                              ...missingQuotedSenderPhones.map((phone) => `+${phone}`),
                          ],
                      },
                      contactDevices: { some: { deviceId: device.pkId } },
                  },
                  select: inboxContactSelect,
              })
            : [];
        const senderContactsByPhone = new Map(
            [...senderContacts, ...quotedSenderContacts].map((contact) => [
                contact.phone.replace(/\D/g, ''),
                contact,
            ]),
        );
        const quotedIncomingById = new Map(
            quotedIncomingMessages.map((message) => [message.id, message]),
        );
        const quotedOutgoingById = new Map<
            string,
            (typeof quotedOutgoingMessages)[number]
        >();
        for (const message of quotedOutgoingMessages) {
            quotedOutgoingById.set(message.id, message);
            if (message.waMessageId) quotedOutgoingById.set(message.waMessageId, message);
        }
        const serialized = page.reverse().map((row) => {
            const decryptedMessage = decryptMessage(row.message);
            const senderProfile = row.participant
                ? senderProfileCache.get(row.participant)
                : undefined;
            const senderProfileEligible = Boolean(
                row.direction === 'incoming'
                && row.isGroup
                && row.participant
                && senderJids.includes(row.participant),
            );
            const senderPhone = row.participant
                ? row.participant.split('@')[0].split(':')[0].replace(/\D/g, '')
                : '';
            const quotedIncomingTarget = row.quotedMessageId
                ? quotedIncomingById.get(row.quotedMessageId)
                : undefined;
            const quotedOutgoingTarget = row.quotedMessageId
                ? quotedOutgoingById.get(row.quotedMessageId)
                : undefined;
            const quotedTarget = row.quotedFromMe === true
                ? quotedOutgoingTarget
                : row.quotedFromMe === false
                    ? quotedIncomingTarget
                    : quotedIncomingTarget || quotedOutgoingTarget;
            const quotedTargetText = quotedTarget
                ? decryptMessage(quotedTarget.message)
                : '';
            const quotedSenderJid = quotedIncomingTarget
                ? [
                      quotedIncomingTarget.editSecret?.senderJid,
                      quotedIncomingTarget.editSecret?.senderAltJid,
                      quotedIncomingTarget.participant,
                      quotedIncomingTarget.from,
                  ].find((jid) => Boolean(phoneFromWhatsAppJid(jid))) || null
                : null;
            const quotedSenderPhone = phoneFromWhatsAppJid(quotedSenderJid);
            const quotedSenderIdentity = row.quotedFromMe === true
                ? { name: 'Anda', phone: null }
                : quotedIncomingTarget
                    ? buildQuotedSenderIdentity({
                          contact: quotedIncomingTarget.contact
                              || (quotedSenderPhone
                                  ? senderContactsByPhone.get(quotedSenderPhone)
                                  : null),
                          jid: quotedSenderJid,
                          pushName: quotedIncomingTarget.pushName,
                      })
                    : quotedOutgoingTarget
                        ? { name: 'Anda', phone: null }
                        : { name: row.quotedSender, phone: null };
            const resolvedQuotedSender = quotedSenderIdentity.name || row.quotedSender;
            const readBy = row.isGroup
                ? filterOwnReadBy(row.readBy, ownIdentityJids)
                : [];
            const readReceipts = row.isGroup
                ? filterOwnMessageReadReceipts(row.readReceipts, ownIdentityJids)
                : [];
            return {
                ...serializePrisma(row),
                readBy,
                readReceipts,
                message: decryptedMessage,
                quotedText: decryptMessage(row.quotedText),
                quotedSender: resolvedQuotedSender,
                quotedSenderPhone: quotedSenderIdentity.phone,
                mediaType: resolveInboxMediaType(
                    row.mediaPath,
                    row.fileName,
                    decryptedMessage,
                ),
                mediaPath: serializeInboxMediaPath(row.mediaPath, deviceUuid, row.id),
                quotedMediaPath: quotedTarget?.mediaPath
                    ? serializeInboxMediaPath(
                          quotedTarget.mediaPath,
                          deviceUuid,
                          quotedTarget.id,
                      )
                    : null,
                quotedMediaType: quotedTarget?.mediaPath
                    ? resolveInboxMediaType(
                          quotedTarget.mediaPath,
                          quotedTarget.fileName,
                          quotedTargetText,
                      )
                    : null,
                quotedFileName: quotedTarget?.fileName || null,
                senderProfilePicUrl: senderProfileEligible && row.participant
                    ? createInboxProfileUrl(deviceUuid, row.participant)
                    : null,
                senderProfileStatus: senderProfile?.status
                    || (senderProfileEligible ? 'pending' : 'unavailable'),
                senderContact: senderPhone
                    ? senderContactsByPhone.get(senderPhone) || null
                    : null,
                pollData: pollStatesByMessageId.get(row.id) || null,
            };
        });

        // Warm only the visible group senders and keep it outside the response
        // critical path. The browser retries the stable signed URL while this
        // cache refresh runs, so opening a group conversation stays immediate.
        const sessionId = device.sessions[0]?.sessionId;
        if (sessionId && verifyInstance(sessionId) && senderJids.length > 0) {
            let profileSession: ReturnType<typeof getInstance> | null = null;
            try {
                profileSession = getInstance(sessionId);
            } catch {
                profileSession = null;
            }
            if (profileSession) {
                const now = Date.now();
                const refreshQueue = senderJids.filter((jid) => {
                    const summary = senderProfileCache.get(jid);
                    if (!summary) return true;
                    if (summary.nextRetryAt && summary.nextRetryAt.getTime() > now) return false;
                    return !summary.expiresAt || summary.expiresAt.getTime() <= now;
                });
                void (async () => {
                    const worker = async () => {
                        while (refreshQueue.length > 0) {
                            const jid = refreshQueue.shift();
                            if (!jid) return;
                            await refreshInboxProfileCache({
                                deviceId: device.pkId,
                                jid,
                                session: profileSession!,
                            });
                            await new Promise((resolve) => setTimeout(resolve, 150));
                        }
                    };
                    await Promise.allSettled([worker(), worker()]);
                })();
            }
        }

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.removeHeader('ETag');
        return res.status(200).json({
            data: serialized,
            metadata: { hasMore, nextCursor },
        });
    } catch (error) {
        logger.error({ error }, 'Error in getDeviceConversationTimeline');
        return res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Get the latest outgoing message per recipient for the Inbox conversation list.
 * Includes broadcast, campaign, direct-send, and other persisted outgoing messages.
 * GET /devices/:deviceId/outbox/conversations?search=<text>
 */
export const getDeviceOutboxConversations: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        if (!isUUID(deviceUuid)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const userPkId = req.authenticatedUser.pkId;
        const device = await prisma.device.findFirst({
            where: { id: deviceUuid, ...accessibleDeviceWhere(userPkId, req.privilege?.pkId) },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const recipients =
            typeof req.query.recipients === 'string'
                ? [...new Set(req.query.recipients.split(',').map((jid) => jid.trim()).filter(Boolean))]
                : [];
        const groupedRecipients = await prisma.outgoingMessage.groupBy({
            by: ['to'],
            where: {
                deviceId: device.pkId,
                inboxHiddenAt: null,
                ...(recipients.length > 0 ? { to: { in: recipients } } : {}),
            },
            _max: { createdAt: true },
            _count: { _all: true },
            orderBy: { _max: { createdAt: 'desc' } },
            take: recipients.length > 0 ? Math.min(recipients.length, 500) : 500,
        });

        if (groupedRecipients.length === 0) {
            return res.status(200).json([]);
        }

        const latestMessages = await prisma.outgoingMessage.findMany({
            where: {
                deviceId: device.pkId,
                inboxHiddenAt: null,
                OR: groupedRecipients
                    .filter((group) => group._max.createdAt)
                    .map((group) => ({ to: group.to, createdAt: group._max.createdAt! })),
            },
            select: {
                id: true,
                waMessageId: true,
                to: true,
                message: true,
                mediaPath: true,
                fileName: true,
                status: true,
                createdAt: true,
                isGroup: true,
                broadcastId: true,
                broadcastType: true,
                contact: {
                    select: inboxContactSelect,
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const latestBroadcastIds = [
            ...new Set(
                latestMessages
                    .map((message) => message.broadcastId)
                    .filter((id): id is number => typeof id === 'number'),
            ),
        ];
        const broadcastRecipientRows = await prisma.broadcastRecipient.findMany({
            where: {
                OR: [
                    { messageId: { in: latestMessages.map((message) => message.id) } },
                    ...(latestBroadcastIds.length > 0
                        ? [{ broadcastId: { in: latestBroadcastIds } }]
                        : []),
                ],
            },
            select: { broadcastId: true, messageId: true, phone: true, jid: true },
        });
        const broadcastPhoneByMessageId = new Map<string, string>();
        const broadcastPhoneByRecipient = new Map<string, string>();
        for (const recipient of broadcastRecipientRows) {
            const phoneJid = canonicalPersonalPhoneJid(recipient.phone);
            if (phoneJid) {
                const phone = phoneJid.split('@')[0];
                if (recipient.messageId) {
                    broadcastPhoneByMessageId.set(recipient.messageId, phone);
                }
                if (recipient.jid) {
                    broadcastPhoneByRecipient.set(
                        `${recipient.broadcastId}:${recipient.jid.toLowerCase()}`,
                        phone,
                    );
                }
            }
        }

        const { decryptOutgoingMessages } = await import('../utils/messageEncryption');
        const decryptedMessages = decryptOutgoingMessages(latestMessages).map((message) => ({
            ...message,
            recipientPhone:
                broadcastPhoneByMessageId.get(message.id) ||
                (message.broadcastId
                    ? broadcastPhoneByRecipient.get(
                          `${message.broadcastId}:${message.to.toLowerCase()}`,
                      )
                    : null) ||
                null,
            mediaType: resolveInboxMediaType(
                message.mediaPath,
                message.fileName,
                message.message,
            ),
            mediaPath: serializeInboxMediaPath(message.mediaPath, deviceUuid, message.id),
        }));
        const recipientJids = [...new Set(decryptedMessages.map((message) => message.to))];
        const recipientPhones = [
            ...new Set(
                [
                    ...recipientJids
                        .filter((jid) => !jid.includes('@g.us') && !jid.includes('@lid'))
                        .map((jid) => jid.split('@')[0].replace(/\D/g, '')),
                    ...decryptedMessages.map((message) => message.recipientPhone || ''),
                ]
                    .filter(Boolean),
            ),
        ];
        const groupRecipientJids = recipientJids.filter((jid) => jid.endsWith('@g.us'));
        const [matchingContacts, incomingIdentities, matchingGroups] = await Promise.all([
            recipientPhones.length > 0
                ? prisma.contact.findMany({
                      where: {
                          phone: {
                              in: [
                                  ...recipientPhones,
                                  ...recipientPhones.map((phone) => `+${phone}`),
                              ],
                          },
                          contactDevices: { some: { deviceId: device.pkId } },
                      },
                      select: inboxContactSelect,
                  })
                : Promise.resolve([]),
            recipientJids.length > 0
                ? prisma.incomingMessage.findMany({
                      where: {
                          deviceId: device.pkId,
                          from: { in: recipientJids },
                      },
                      orderBy: { receivedAt: 'desc' },
                      select: {
                          from: true,
                          pushName: true,
                          groupName: true,
                          groupPicUrl: true,
                          profilePicUrl: true,
                          contact: {
                              select: inboxContactSelect,
                          },
                      },
                  })
                : Promise.resolve([]),
            groupRecipientJids.length > 0
                ? prisma.whatsAppGroup.findMany({
                      where: {
                          deviceId: device.pkId,
                          groupId: { in: groupRecipientJids },
                      },
                      select: { groupId: true, groupName: true },
                  })
                : Promise.resolve([]),
        ]);
        const contactsByPhone = new Map(
            matchingContacts.map((contact) => [contact.phone.replace(/\D/g, ''), contact]),
        );
        const incomingIdentityByJid = new Map<string, (typeof incomingIdentities)[number]>();
        for (const identity of incomingIdentities) {
            if (!incomingIdentityByJid.has(identity.from)) {
                incomingIdentityByJid.set(identity.from, identity);
            }
        }
        const groupNameByJid = new Map(
            matchingGroups.map((group) => [group.groupId, group.groupName]),
        );
        const counts = new Map(
            groupedRecipients.map((group) => [group.to, group._count._all]),
        );
        const profileCacheByJid = await getInboxProfileCacheSummaries(
            device.pkId,
            recipientJids,
        );
        const uniqueRecipients = new Set<string>();
        let conversations = decryptedMessages
            .filter((message) => {
                if (uniqueRecipients.has(message.to)) return false;
                uniqueRecipients.add(message.to);
                return true;
            })
            .map((message) => {
                const incomingIdentity = incomingIdentityByJid.get(message.to);
                const phone =
                    message.recipientPhone || message.to.split('@')[0].replace(/\D/g, '');
                const contact =
                    message.contact || incomingIdentity?.contact || contactsByPhone.get(phone) || null;
                const profileCache = profileCacheByJid.get(message.to);
                const hasCachedProfile = Boolean(profileCache?.hasImage);

                return {
                    ...message,
                    contact,
                    pushName: incomingIdentity?.pushName || null,
                    groupName:
                        incomingIdentity?.groupName || groupNameByJid.get(message.to) || null,
                    groupPicUrl: message.to.endsWith('@g.us') && hasCachedProfile
                        ? createInboxProfileUrl(deviceUuid, message.to)
                        : null,
                    profilePicUrl:
                        !message.to.endsWith('@g.us') &&
                        !message.to.endsWith('@lid') &&
                        hasCachedProfile
                            ? createInboxProfileUrl(deviceUuid, message.to)
                            : null,
                    profilePictureStatus: profileCache?.status || 'unknown',
                    messageCount: counts.get(message.to) || 1,
                };
            });

        const search = typeof req.query.search === 'string' ? req.query.search.trim().toLowerCase() : '';
        if (search) {
            conversations = conversations.filter((conversation) => {
                const contactName = conversation.contact
                    ? `${conversation.contact.firstName} ${conversation.contact.lastName || ''}`
                    : '';
                return [conversation.to, conversation.message || '', contactName]
                    .join(' ')
                    .toLowerCase()
                    .includes(search);
            });
        }

        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.removeHeader('ETag');
        res.status(200).json(conversations);
    } catch (error) {
        logger.error({ error }, 'Error in getDeviceOutboxConversations');
        res.status(500).json({ message: 'Internal server error' });
    }
};

/**
 * Cleanup scheduled jobs on graceful shutdown
 * Prevents memory leaks and ensures clean process termination
 */
export function shutdownScheduledJobs(): void {
    logger.info(`[Device] Shutting down ${scheduledJobs.length} scheduled jobs...`);
    for (const job of scheduledJobs) {
        if (job) {
            job.cancel();
        }
    }
    scheduledJobs.length = 0;
    logger.info('[Device] All scheduled jobs cancelled');
}

/**
 * Merge legacy/alternate personal-chat keys into one phone-number JID. New
 * messages already prefer remoteJidAlt, but old @lid summaries can otherwise
 * remain visible beside broadcast messages sent to the phone-number JID.
 */
async function repairDeviceConversationIdentities(devicePkId: number): Promise<number> {
    const conversations = await prisma.conversation.findMany({
        where: {
            deviceId: devicePkId,
            isGroup: false,
            OR: [
                { jid: { endsWith: '@lid' } },
                { jid: { endsWith: '@hosted.lid' } },
                { jid: { contains: ':', endsWith: '@s.whatsapp.net' } },
            ],
        },
        select: {
            jid: true,
            contact: { select: { phone: true } },
        },
    });
    if (conversations.length === 0) return 0;

    const mappings = new Map<string, string>();
    const unresolvedLids: string[] = [];
    for (const conversation of conversations) {
        const sourceJid = conversation.jid.trim().toLowerCase();
        const directPhoneJid = canonicalPersonalPhoneJid(sourceJid);
        if (directPhoneJid) {
            if (sourceJid !== directPhoneJid) mappings.set(sourceJid, directPhoneJid);
            continue;
        }

        if (!sourceJid.endsWith('lid')) continue;
        const contactPhoneJid = canonicalPersonalPhoneJid(conversation.contact?.phone);
        if (contactPhoneJid) mappings.set(sourceJid, contactPhoneJid);
        else unresolvedLids.push(sourceJid);
    }

    if (unresolvedLids.length > 0) {
        const sessionRows = await prisma.session.findMany({
            where: { deviceId: devicePkId },
            distinct: ['sessionId'],
            select: { sessionId: true },
        });
        const sessionIds = sessionRows.map((row) => row.sessionId);
        const rawMessages = sessionIds.length > 0
            ? await prisma.message.findMany({
                  where: {
                      remoteJid: { in: unresolvedLids },
                      sessionId: { in: sessionIds },
                  },
                  orderBy: { pkId: 'desc' },
                  distinct: ['remoteJid'],
                  select: { remoteJid: true, key: true },
              })
            : [];
        for (const rawMessage of rawMessages) {
            if (mappings.has(rawMessage.remoteJid)) continue;
            const phoneJid = phoneJidFromMessageKey(rawMessage.key);
            if (phoneJid) mappings.set(rawMessage.remoteJid, phoneJid);
        }

        for (const lid of unresolvedLids) {
            if (mappings.has(lid)) continue;
            for (const sessionId of sessionIds) {
                if (!verifyInstance(sessionId)) continue;
                try {
                    const session = getInstance(sessionId) as unknown as WhatsAppIdentitySession;
                    const mapped = await session?.signalRepository?.lidMapping?.getPNForLID?.(lid);
                    const phoneJid = canonicalPersonalPhoneJid(mapped);
                    if (phoneJid) {
                        mappings.set(lid, phoneJid);
                        break;
                    }
                } catch (error) {
                    logger.debug(
                        { devicePkId, sessionId },
                        'Could not resolve legacy Inbox LID conversation',
                    );
                }
            }
        }
    }

    let repaired = 0;
    for (const [sourceJid, canonicalJid] of mappings) {
        if (!canonicalJid || sourceJid === canonicalJid) continue;
        await prisma.$transaction(async (tx) => {
            await tx.incomingMessage.updateMany({
                where: { deviceId: devicePkId, from: sourceJid },
                data: { from: canonicalJid, updatedAt: new Date() },
            });
            await tx.outgoingMessage.updateMany({
                where: { deviceId: devicePkId, to: sourceJid },
                data: { to: canonicalJid, updatedAt: new Date() },
            });
            // Update triggers rebuild the canonical summary. Remove an orphaned
            // alternate row as the final step so the list cannot show both keys.
            await tx.conversation.deleteMany({
                where: { deviceId: devicePkId, jid: sourceJid },
            });
        });
        await prisma.$executeRaw`
            UPDATE "message_reaction"
            SET "conversation_jid" = ${canonicalJid},
                "updated_at" = CURRENT_TIMESTAMP
            WHERE "device_id" = ${devicePkId}
              AND "conversation_jid" = ${sourceJid}
        `.catch(() => {
            logger.warn(
                { devicePkId, sourceJid, canonicalJid },
                'Could not migrate reaction conversation identity',
            );
        });
        repaired += 1;
    }
    return repaired;
}

/**
 * Convert legacy personal-chat @lid identities to their phone-number JID using
 * Baileys' remoteJidAlt metadata. The normalized value is also persisted so
 * future reads, read acknowledgements, and deletes use one conversation key.
 */
async function normalizeIncomingConversationIdentities(messages: any[], devicePkId: number) {
    const lidMessages = messages.filter(
        (message) => typeof message.from === 'string' && message.from.endsWith('@lid'),
    );
    if (lidMessages.length === 0) return messages;

    const rawMessages = await prisma.message.findMany({
        where: {
            OR: lidMessages.map((message) => ({
                id: message.id,
                remoteJid: message.from,
            })),
        },
        select: { id: true, key: true },
    });

    const canonicalJidByMessageId = new Map<string, string>();
    for (const rawMessage of rawMessages) {
        const key = rawMessage.key as Record<string, unknown> | null;
        const remoteJidAlt = typeof key?.remoteJidAlt === 'string' ? key.remoteJidAlt : '';
        if (!remoteJidAlt.endsWith('@s.whatsapp.net')) continue;

        const [localPart] = remoteJidAlt.split('@');
        const phone = localPart.split(':')[0].replace(/\D/g, '');
        if (phone) canonicalJidByMessageId.set(rawMessage.id, `${phone}@s.whatsapp.net`);
    }

    // Recent messages are not always present in the generic Message history
    // table yet. Baileys keeps the same LID -> PN mapping in the active Signal
    // repository, so use it as the authoritative fallback.
    await Promise.all(
        lidMessages
            .filter((message) => !canonicalJidByMessageId.has(message.id) && message.sessionId)
            .map(async (message) => {
                try {
                    const session = getInstance(message.sessionId) as any;
                    const phoneJid = await session?.signalRepository?.lidMapping?.getPNForLID(
                        message.from,
                    );
                    if (typeof phoneJid !== 'string' || !phoneJid.endsWith('@s.whatsapp.net')) {
                        return;
                    }

                    const [localPart] = phoneJid.split('@');
                    const phone = localPart.split(':')[0].replace(/\D/g, '');
                    if (phone) {
                        canonicalJidByMessageId.set(message.id, `${phone}@s.whatsapp.net`);
                    }
                } catch (error) {
                    logger.debug(
                        { error, messageId: message.id },
                        'Could not resolve Inbox LID from the active WhatsApp session',
                    );
                }
            }),
    );

    if (canonicalJidByMessageId.size === 0) return messages;

    const phones = [...new Set(
        [...canonicalJidByMessageId.values()].map((jid) => jid.split('@')[0]),
    )];
    const contacts = await prisma.contact.findMany({
        where: {
            phone: { in: [...phones, ...phones.map((phone) => `+${phone}`)] },
            contactDevices: { some: { deviceId: devicePkId } },
        },
        select: {
            pkId: true,
            firstName: true,
            lastName: true,
            phone: true,
            colorCode: true,
        },
    });
    const contactsByPhone = new Map(
        contacts.map((contact) => [contact.phone.replace(/\D/g, ''), contact]),
    );

    const repairs: Promise<unknown>[] = [];
    const normalizedMessages = messages.map((message) => {
        const canonicalJid = canonicalJidByMessageId.get(message.id);
        if (!canonicalJid) return message;

        const phone = canonicalJid.split('@')[0];
        const contact = contactsByPhone.get(phone) || message.contact || null;
        repairs.push(
            prisma.incomingMessage.update({
                where: { id: message.id },
                data: {
                    from: canonicalJid,
                    ...(contact?.pkId ? { contactId: contact.pkId } : {}),
                    updatedAt: new Date(),
                },
            }),
        );

        return {
            ...message,
            from: canonicalJid,
            contact: contact
                ? {
                      firstName: contact.firstName,
                      lastName: contact.lastName,
                      phone: contact.phone,
                      colorCode: contact.colorCode,
                  }
                : null,
        };
    });

    const repairResults = await Promise.allSettled(repairs);
    const failedRepairs = repairResults.filter((result) => result.status === 'rejected').length;
    if (failedRepairs > 0) {
        logger.warn(
            { devicePkId, failedRepairs },
            'Some legacy Inbox LID identities could not be normalized',
        );
    }

    return normalizedMessages;
}

/**
 * Serve persisted Inbox/outbox media through a regular HTTPS URL. The URL
 * contains an HMAC token and can therefore be used by native media elements
 * without exposing a user JWT, filesystem path, or database data URL.
 */
export const getInboxMedia: RequestHandler = async (req, res) => {
    try {
        const { deviceId, messageId } = req.params;
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        if (!isUUID(deviceId) || !token || !verifyInboxMediaToken(deviceId, messageId, token)) {
            return res.status(404).end();
        }

        const incomingMessage = await prisma.incomingMessage.findFirst({
            where: {
                id: messageId,
                device: { id: deviceId },
            },
            select: { mediaPath: true },
        });
        const outgoingMessage = incomingMessage?.mediaPath
            ? null
            : await prisma.outgoingMessage.findFirst({
                  where: {
                      id: messageId,
                      device: { id: deviceId },
                  },
                  select: { mediaPath: true },
              });
        const storedMedia = incomingMessage?.mediaPath || outgoingMessage?.mediaPath;
        if (!storedMedia) return res.status(404).end();
        const wantsThumbnail = req.query.thumbnail === '1';

        const sendThumbnail = async (source: Buffer | string) => {
            const thumbnail = await sharp(source, {
                animated: false,
                limitInputPixels: 64_000_000,
            })
                .rotate()
                .resize({
                    width: 640,
                    height: 640,
                    fit: 'inside',
                    withoutEnlargement: true,
                })
                .webp({ quality: 78 })
                .toBuffer();
            res.setHeader('Content-Type', 'image/webp');
            res.setHeader('Content-Length', String(thumbnail.length));
            return res.status(200).send(thumbnail);
        };

        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'private, max-age=86400');

        if (storedMedia.startsWith('data:')) {
            const match = storedMedia.match(/^data:([^;,]+);base64,(.+)$/);
            if (!match) return res.status(415).end();

            const contentType = match[1].startsWith('image/')
                ? match[1]
                : 'application/octet-stream';
            const mediaBuffer = Buffer.from(match[2], 'base64');
            if (mediaBuffer.length === 0) return res.status(404).end();

            if (wantsThumbnail) {
                try {
                    return await sendThumbnail(mediaBuffer);
                } catch {
                    return res.status(415).end();
                }
            }

            res.setHeader('Content-Type', contentType);
            res.setHeader('Content-Length', String(mediaBuffer.length));
            return res.status(200).send(mediaBuffer);
        }

        if (/^https?:\/\//i.test(storedMedia)) {
            return res.redirect(storedMedia);
        }

        const mediaRoot = path.resolve('media');
        const mediaFile = path.resolve(storedMedia);
        if (mediaFile !== mediaRoot && !mediaFile.startsWith(`${mediaRoot}${path.sep}`)) {
            return res.status(404).end();
        }
        if (!fs.existsSync(mediaFile)) return res.status(404).end();
        if (wantsThumbnail) {
            const extension = path.extname(mediaFile).toLowerCase();
            if (!['.jpg', '.jpeg', '.png', '.gif', '.webp'].includes(extension)) {
                return res.status(415).end();
            }
            try {
                return await sendThumbnail(mediaFile);
            } catch {
                return res.status(415).end();
            }
        }
        return res.sendFile(mediaFile);
    } catch (error) {
        logger.error({ error, messageId: req.params.messageId }, 'Failed to serve Inbox media');
        return res.status(500).end();
    }
};

/** Serve a conversation profile picture without exposing WhatsApp CDN details. */
export const getInboxProfilePicture: RequestHandler = async (req, res) => {
    try {
        const { deviceId, jid } = req.params;
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        const expires = Number(req.query.expires);
        if (
            !isUUID(deviceId) ||
            !jid ||
            !token ||
            !verifyInboxProfileToken(deviceId, jid, expires, token)
        ) {
            return res.status(404).end();
        }

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            select: { pkId: true },
        });
        if (!device) return res.status(404).end();

        const picture = await getInboxProfileCache(device.pkId, jid);
        if (!picture?.imageData?.length || !picture.mimeType?.startsWith('image/')) {
            res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
            res.setHeader('Cache-Control', 'no-store');
            res.setHeader('X-Profile-Status', picture?.status || 'unknown');
            if (picture?.nextRetryAt) {
                const retryAfter = Math.max(
                    60,
                    Math.ceil((picture.nextRetryAt.getTime() - Date.now()) / 1000),
                );
                res.setHeader('Retry-After', String(retryAfter));
            }
            return res.status(204).end();
        }

        // Copy through plain byte values because the cache and the application
        // currently resolve different generations of Node's Buffer types.
        const imageData = Buffer.from(Array.from(picture.imageData));
        res.setHeader('Content-Type', picture.mimeType);
        res.setHeader('Content-Length', String(imageData.length));
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'private, max-age=3600');
        res.setHeader('X-Profile-Status', picture.status);
        return res.status(200).send(imageData);
    } catch (error) {
        logger.error({ code: (error as { code?: unknown })?.code }, 'Failed to serve Inbox profile picture');
        res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
        res.setHeader('Cache-Control', 'no-store');
        return res.status(204).end();
    }
};

/**
 * Get incoming messages for a device (persists across session reconnects)
 * GET /devices/:deviceId/inbox
 * Uses deviceId (UUID) → resolved to pkId for DB query.
 * This endpoint uses authMiddleware (user JWT), not deviceTokenOnly,
 * so it works even when the device is disconnected.
 */
export const getDeviceInbox: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        if (!isUUID(deviceUuid)) {
            return res.status(400).json({ message: 'Invalid deviceId' });
        }

        const userPkId = req.authenticatedUser.pkId;
        const device = await prisma.device.findFirst({
            where: { id: deviceUuid, ...accessibleDeviceWhere(userPkId, req.privilege?.pkId) },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const repairedConversationAliases = await repairDeviceConversationIdentities(
            device.pkId,
        );
        if (repairedConversationAliases > 0) {
            logger.info(
                { devicePkId: device.pkId, repairedConversationAliases },
                'Merged alternate Inbox conversation identities',
            );
        }

        const {
            page = 1,
            pageSize = 25,
            limit = 30,
            before,
            phoneNumber,
            message,
            contactName,
            conversationJid,
            summary,
        } = req.query;
        const requestedPage = Math.max(1, Number(page) || 1);
        const requestedPageSize = Math.min(50, Math.max(1, Number(pageSize) || 25));
        const directConversationJid = typeof conversationJid === 'string'
            ? conversationJid.trim()
            : '';
        const requestedConversationLimit = Math.min(50, Math.max(1, Number(limit) || 30));
        let conversationBefore: Date | null = null;
        if (directConversationJid && typeof before === 'string' && before.trim()) {
            conversationBefore = new Date(before);
            if (Number.isNaN(conversationBefore.getTime())) {
                return res.status(400).json({ message: 'Invalid before cursor' });
            }
        }

        const whereClause: any = {
            deviceId: device.pkId,
            inboxHiddenAt: null,
            from: directConversationJid
                || (phoneNumber ? { contains: phoneNumber.toString() } : undefined),
            message: message
                ? { contains: message.toString(), mode: 'insensitive' as const }
                : undefined,
        };

        if (contactName) {
            whereClause.contact = {
                OR: [
                    { firstName: { contains: contactName.toString(), mode: 'insensitive' as const } },
                    { lastName: { contains: contactName.toString(), mode: 'insensitive' as const } },
                ],
            };
        }

        const hasSearchFilter = Boolean(phoneNumber || message || contactName);
        const useConversationSummaries = String(summary || '').toLowerCase() === 'true';
        const todayStart = new Date();
        todayStart.setHours(0, 0, 0, 0);
        let conversationIndex = new Map<
            string,
            { latestAt: Date; incomingCount: number; outgoingCount: number }
        >();
        let unreadCountByJid = new Map<string, number>();
        let totalConversations = 0;
        let totalMessages = 0;
        let totalUnreadCount = 0;
        let totalPages = 1;
        let currentPage = requestedPage;
        let conversationKeys: string[] = [];
        let todayIncomingCount = 0;
        let summaryRows: InboxConversationSummary[] = [];

        if (!directConversationJid && !hasSearchFilter) {
            // The common Inbox path reads the denormalized summary table. This
            // replaces three full message GROUP BY queries on every page load.
            const [summaryCount, summaryTotals, todayCount] = await Promise.all([
                prisma.conversation.count({ where: { deviceId: device.pkId } }),
                prisma.conversation.aggregate({
                    where: { deviceId: device.pkId },
                    _sum: { incomingCount: true, outgoingCount: true, unreadCount: true },
                }),
                prisma.incomingMessage.count({
                    where: {
                        deviceId: device.pkId,
                        inboxHiddenAt: null,
                        receivedAt: { gte: todayStart },
                    },
                }),
            ]);
            totalConversations = summaryCount;
            totalMessages = Number(summaryTotals._sum.incomingCount || 0)
                + Number(summaryTotals._sum.outgoingCount || 0);
            totalUnreadCount = Number(summaryTotals._sum.unreadCount || 0);
            todayIncomingCount = todayCount;
            totalPages = Math.max(1, Math.ceil(totalConversations / requestedPageSize));
            currentPage = Math.min(requestedPage, totalPages);
            const summaries = await prisma.conversation.findMany({
                where: { deviceId: device.pkId },
                orderBy: [{ lastMessageAt: 'desc' }, { pkId: 'desc' }],
                skip: (currentPage - 1) * requestedPageSize,
                take: requestedPageSize,
                select: inboxConversationSummarySelect,
            });
            summaryRows = summaries;
            summaries.forEach((summary) => {
                if (!summary.lastMessageAt) return;
                conversationIndex.set(summary.jid, {
                    latestAt: summary.lastMessageAt,
                    incomingCount: summary.incomingCount,
                    outgoingCount: summary.outgoingCount,
                });
                unreadCountByJid.set(summary.jid, summary.unreadCount);
            });
            conversationKeys = summaries.map((summary) => summary.jid);
        } else {
            // Message-content/contact searches and the legacy direct endpoint
            // retain their exact filtering semantics.
            const [incomingGroups, outgoingGroups, unreadGroups, todayCount] = await Promise.all([
                prisma.incomingMessage.groupBy({
                    by: ['from'],
                    where: whereClause,
                    _max: { receivedAt: true },
                    _count: { _all: true },
                }),
                (!hasSearchFilter || Boolean(directConversationJid))
                    ? prisma.outgoingMessage.groupBy({
                          by: ['to'],
                          where: {
                              deviceId: device.pkId,
                              inboxHiddenAt: null,
                              ...(directConversationJid ? { to: directConversationJid } : {}),
                          },
                          _max: { createdAt: true },
                          _count: { _all: true },
                      })
                    : Promise.resolve([]),
                prisma.incomingMessage.groupBy({
                    by: ['from'],
                    where: { ...whereClause, isRead: false },
                    _count: { _all: true },
                }),
                prisma.incomingMessage.count({
                    where: {
                        deviceId: device.pkId,
                        inboxHiddenAt: null,
                        receivedAt: { gte: todayStart },
                    },
                }),
            ]);
            unreadCountByJid = new Map(
                unreadGroups.map((group) => [group.from, group._count._all]),
            );
            totalUnreadCount = unreadGroups.reduce(
                (sum, group) => sum + group._count._all,
                0,
            );
            for (const group of incomingGroups) {
                if (!group._max.receivedAt) continue;
                conversationIndex.set(group.from, {
                    latestAt: group._max.receivedAt,
                    incomingCount: group._count._all,
                    outgoingCount: 0,
                });
            }
            for (const group of outgoingGroups) {
                if (!group._max.createdAt) continue;
                const existing = conversationIndex.get(group.to);
                if (existing) {
                    if (group._max.createdAt > existing.latestAt) {
                        existing.latestAt = group._max.createdAt;
                    }
                    existing.outgoingCount = group._count._all;
                } else {
                    conversationIndex.set(group.to, {
                        latestAt: group._max.createdAt,
                        incomingCount: 0,
                        outgoingCount: group._count._all,
                    });
                }
            }
            const orderedConversationKeys = [...conversationIndex.entries()]
                .sort((left, right) => right[1].latestAt.getTime() - left[1].latestAt.getTime())
                .map(([jid]) => jid);
            totalConversations = orderedConversationKeys.length;
            totalMessages = [...conversationIndex.values()].reduce(
                (sum, item) => sum + item.incomingCount + item.outgoingCount,
                0,
            );
            totalPages = Math.max(1, Math.ceil(totalConversations / requestedPageSize));
            currentPage = Math.min(requestedPage, totalPages);
            const offset = (currentPage - 1) * requestedPageSize;
            conversationKeys = orderedConversationKeys.slice(offset, offset + requestedPageSize);
            todayIncomingCount = todayCount;
        }

        if (useConversationSummaries && !directConversationJid && !hasSearchFilter) {
            const summaryJids = summaryRows.map((summary) => summary.jid);
            const groupJids = summaryJids.filter((jid) => jid.endsWith('@g.us'));
            const outgoingSummaryMessageIds = summaryRows
                .filter((summary) => summary.lastMessageDirection === 'outgoing')
                .map((summary) => summary.lastMessageId)
                .filter((id): id is string => Boolean(id));
            const [profileCacheByJid, inboxGroups, summaryBroadcastRecipients] = await Promise.all([
                getInboxProfileCacheSummaries(device.pkId, summaryJids),
                groupJids.length > 0
                    ? prisma.whatsAppGroup.findMany({
                          where: { deviceId: device.pkId, groupId: { in: groupJids } },
                          select: { groupId: true, groupName: true },
                      })
                    : Promise.resolve([]),
                outgoingSummaryMessageIds.length > 0
                    ? prisma.broadcastRecipient.findMany({
                          where: { messageId: { in: outgoingSummaryMessageIds } },
                          select: { messageId: true, phone: true },
                      })
                    : Promise.resolve([]),
            ]);
            const groupNameByJid = new Map(
                inboxGroups.map((group) => [group.groupId, group.groupName]),
            );
            const summaryRecipientPhoneByMessageId = new Map<string, string>();
            for (const recipient of summaryBroadcastRecipients) {
                if (!recipient.messageId) continue;
                const phoneJid = canonicalPersonalPhoneJid(recipient.phone);
                if (phoneJid) {
                    summaryRecipientPhoneByMessageId.set(
                        recipient.messageId,
                        phoneJid.split('@')[0],
                    );
                }
            }
            const serializedSummaries = summaryRows.map((summary) => {
                const isGroup = summary.isGroup || summary.jid.endsWith('@g.us');
                const message = decryptMessage(summary.lastMessagePreview || '');
                const profileCache = profileCacheByJid.get(summary.jid);
                const profileUrl = profileCache?.hasImage
                    ? createInboxProfileUrl(deviceUuid, summary.jid)
                    : null;
                return {
                    id: summary.lastMessageId || `conversation:${summary.jid}`,
                    from: summary.jid,
                    message,
                    mediaPath: serializeInboxMediaPath(
                        summary.lastMediaPath,
                        deviceUuid,
                        summary.lastMessageId || `conversation:${summary.jid}`,
                    ),
                    mediaType: resolveInboxMediaType(
                        summary.lastMediaPath,
                        summary.lastFileName,
                        message,
                    ),
                    fileName: summary.lastFileName || null,
                    receivedAt: summary.lastMessageAt,
                    isOutgoing: summary.lastMessageDirection === 'outgoing',
                    isGroup,
                    recipientPhone: summary.lastMessageId
                        ? summaryRecipientPhoneByMessageId.get(summary.lastMessageId) || null
                        : null,
                    contact: summary.contact,
                    pushName: summary.pushName,
                    groupName: summary.groupName || groupNameByJid.get(summary.jid) || null,
                    profilePicUrl: !isGroup ? profileUrl : null,
                    groupPicUrl: isGroup ? profileUrl : null,
                    profilePictureStatus: profileCache?.status || 'unknown',
                    conversationIncomingCount: summary.incomingCount,
                    conversationOutgoingCount: summary.outgoingCount,
                    conversationMessageCount: summary.incomingCount + summary.outgoingCount,
                    conversationUnreadCount: summary.unreadCount,
                };
            });

            res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
            res.setHeader('Pragma', 'no-cache');
            res.setHeader('Expires', '0');
            res.removeHeader('ETag');
            return res.status(200).json({
                data: serializedSummaries,
                total: totalMessages,
                metadata: {
                    totalMessages,
                    totalConversations,
                    totalUnreadCount,
                    currentPage,
                    totalPages,
                    hasMore: currentPage < totalPages,
                    conversationKeys,
                    conversationHasMore: false,
                    conversationNextCursor: null,
                    todayIncomingCount,
                    summaryBacked: true,
                },
            });
        }

        // Keep enough history for the detail modal while bounding the response.
        // Profile/media binaries are served by signed URLs, so they are not
        // duplicated in this JSON response.
        const messagesByConversation = await Promise.all(
            conversationKeys.map((from) =>
                prisma.incomingMessage.findMany({
                    // The list needs only one latest message. Conversation detail
                    // is fetched lazily in small cursor-based pages.
                    take: directConversationJid ? requestedConversationLimit + 1 : 1,
                    where: {
                        ...whereClause,
                        from,
                        ...(directConversationJid && conversationBefore
                            ? { receivedAt: { lt: conversationBefore } }
                            : {}),
                    },
                    include: {
                        contact: {
                            select: inboxContactSelect,
                        },
                    },
                    orderBy: { receivedAt: 'desc' },
                }),
            ),
        );
        const fetchedMessages = messagesByConversation.flat();
        const conversationHasMore = Boolean(
            directConversationJid && fetchedMessages.length > requestedConversationLimit,
        );
        const messages = directConversationJid
            ? fetchedMessages.slice(0, requestedConversationLimit)
            : fetchedMessages;
        const normalizedMessages = await normalizeIncomingConversationIdentities(
            messages,
            device.pkId,
        );
        const normalizedJids = [...new Set(normalizedMessages.map((message) => message.from))];
        const normalizedGroupJids = normalizedJids.filter((jid) => jid.endsWith('@g.us'));
        const [profileCacheByJid, inboxGroups] = await Promise.all([
            getInboxProfileCacheSummaries(device.pkId, normalizedJids),
            normalizedGroupJids.length > 0
                ? prisma.whatsAppGroup.findMany({
                      where: {
                          deviceId: device.pkId,
                          groupId: { in: normalizedGroupJids },
                      },
                      select: { groupId: true, groupName: true },
                  })
                : Promise.resolve([]),
        ]);
        const inboxGroupNameByJid = new Map(
            inboxGroups.map((group) => [group.groupId, group.groupName]),
        );
        const pollStatesByMessageId = await getMessagePollStates(
            device.pkId,
            normalizedMessages.map((message) => message.id),
        );
        const serialized = normalizedMessages.map((message) => {
            const item = serializePrisma(decryptIncomingMessage(message));
            if (message.from.endsWith('@g.us') && !item.groupName) {
                item.groupName = inboxGroupNameByJid.get(message.from) || null;
            }
            item.mediaType = resolveInboxMediaType(
                message.mediaPath,
                message.fileName,
                item.message,
            );
            item.mediaPath = serializeInboxMediaPath(
                message.mediaPath,
                deviceUuid,
                message.id,
            );
            const profileCache = profileCacheByJid.get(message.from);
            const conversationStats = conversationIndex.get(message.from);
            item.conversationIncomingCount = conversationStats?.incomingCount || 0;
            item.conversationOutgoingCount = conversationStats?.outgoingCount || 0;
            item.conversationUnreadCount = unreadCountByJid.get(message.from) || 0;
            item.profilePictureStatus = profileCache?.status || 'unknown';
            if (profileCache?.hasImage) {
                const profileUrl = createInboxProfileUrl(deviceUuid, message.from);
                if (message.from.endsWith('@g.us')) {
                    item.groupPicUrl = profileUrl;
                } else if (!message.from.endsWith('@lid')) {
                    item.profilePicUrl = profileUrl;
                }
            } else {
                item.profilePicUrl = null;
                item.groupPicUrl = null;
            }
            item.pollData = pollStatesByMessageId.get(message.id) || null;
            return item;
        });
        const hasMore = currentPage < totalPages;

        // Inbox state changes through real-time events and read acknowledgements.
        // Never let browsers or reverse proxies serve an older unread state.
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.removeHeader('ETag');

        res.status(200).json({
            data: serialized,
            total: totalMessages,
            metadata: {
                totalMessages,
                totalConversations,
                totalUnreadCount,
                currentPage,
                totalPages,
                hasMore,
                conversationKeys,
                conversationHasMore,
                conversationNextCursor:
                    directConversationJid && messages.length > 0
                        ? messages[messages.length - 1].receivedAt.toISOString()
                        : null,
                todayIncomingCount,
            },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

/** Get the people who read one outgoing Inbox message, including read time. */
export const getInboxMessageReadReceipts: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        const messageId = typeof req.query.messageId === 'string'
            ? req.query.messageId.trim()
            : '';
        if (!isUUID(deviceUuid) || !messageId) {
            return res.status(400).json({ message: 'Invalid read receipt query' });
        }

        const device = await prisma.device.findFirst({
            where: {
                id: deviceUuid,
                ...accessibleDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            select: {
                pkId: true,
                id: true,
                phone: true,
                sessions: {
                    where: { id: { contains: 'config' } },
                    select: { sessionId: true },
                    orderBy: { pkId: 'desc' },
                    take: 1,
                },
            },
        });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const outgoing = await prisma.outgoingMessage.findFirst({
            where: {
                deviceId: device.pkId,
                OR: [{ id: messageId }, { waMessageId: messageId }],
            },
            select: {
                pkId: true,
                id: true,
                waMessageId: true,
                to: true,
                isGroup: true,
                readBy: true,
                readReceipts: true,
                updatedAt: true,
            },
        });
        if (!outgoing) return res.status(404).json({ message: 'Message not found' });

        // One-to-one chats already communicate read state through the WhatsApp
        // ticks. The per-person reader list is a group-only feature.
        if (!outgoing.isGroup) {
            res.setHeader('Cache-Control', 'no-store');
            return res.status(200).json({
                messageId: outgoing.waMessageId || outgoing.id,
                readCount: 0,
                readers: [],
            });
        }

        const ownIdentityJids = getOwnIdentityJids(
            device.phone,
            device.sessions[0]?.sessionId,
        );
        let storedReceipts = filterOwnMessageReadReceipts(
            outgoing.readReceipts,
            ownIdentityJids,
        );
        if (storedReceipts.length === 0 && Array.isArray(outgoing.readBy)) {
            storedReceipts = filterOwnReadBy(outgoing.readBy, ownIdentityJids)
                .map((readerJid) => String(readerJid || '').trim())
                .filter(Boolean)
                .map((readerJid) => ({
                    readerJid,
                    readAt: outgoing.updatedAt.toISOString(),
                    estimated: true,
                }));
        }

        const sessionId = device.sessions[0]?.sessionId;
        let profileSession: ReturnType<typeof getInstance> | null = null;
        if (sessionId && verifyInstance(sessionId)) {
            try {
                profileSession = getInstance(sessionId);
            } catch {
                profileSession = null;
            }
        }
        const identityAliases = profileSession
            ? await resolveReadReceiptIdentityAliases(
                  profileSession,
                  outgoing.to,
                  storedReceipts.map((receipt) => receipt.readerJid),
              )
            : new Map();
        const resolvedReceipts = await resolveMessageReadReceipts(
            device.pkId,
            storedReceipts,
            identityAliases,
        );

        // Persist the resolved PN/name alongside the private LID. This keeps the
        // reader list useful after reconnects, when the in-memory LID map is gone.
        const enrichedReceipts = resolvedReceipts.map((receipt) => ({
            readerJid: receipt.readerJid,
            readAt: receipt.readAt,
            estimated: receipt.estimated,
            ...(receipt.readerDisplayName
                ? { readerDisplayName: receipt.readerDisplayName }
                : {}),
            ...(receipt.readerPhone ? { readerPhone: receipt.readerPhone } : {}),
            ...(receipt.profileJid ? { profileJid: receipt.profileJid } : {}),
        }));
        if (JSON.stringify(enrichedReceipts) !== JSON.stringify(storedReceipts)) {
            try {
                await prisma.outgoingMessage.update({
                    where: { pkId: outgoing.pkId },
                    data: {
                        readReceipts: enrichedReceipts as unknown as Prisma.InputJsonValue,
                    },
                });
            } catch (error) {
                logger.debug(
                    { code: (error as { code?: unknown })?.code },
                    'Failed to cache enriched message reader identities',
                );
            }
        }
        const profileJids = [
            ...new Set(
                resolvedReceipts
                    .map((receipt) => receipt.profileJid)
                    .filter((jid): jid is string => Boolean(jid)),
            ),
        ];
        const profileSummaries = await getInboxProfileCacheSummaries(
            device.pkId,
            profileJids,
        );
        const readers = resolvedReceipts.map((receipt) => {
            const summary = receipt.profileJid
                ? profileSummaries.get(receipt.profileJid)
                : undefined;
            return {
                ...receipt,
                readerProfilePicUrl: receipt.profileJid
                    ? createInboxProfileUrl(device.id, receipt.profileJid)
                    : null,
                readerProfileStatus: summary?.status
                    || (receipt.profileJid ? 'pending' : 'unavailable'),
            };
        });

        if (profileSession && profileJids.length > 0) {
            const now = Date.now();
            const refreshQueue = profileJids.filter((jid) => {
                const summary = profileSummaries.get(jid);
                if (!summary) return true;
                if (summary.nextRetryAt && summary.nextRetryAt.getTime() > now) return false;
                return !summary.expiresAt || summary.expiresAt.getTime() <= now;
            });
            void (async () => {
                const worker = async () => {
                    while (refreshQueue.length > 0) {
                        const jid = refreshQueue.shift();
                        if (!jid) return;
                        await refreshInboxProfileCache({
                            deviceId: device.pkId,
                            jid,
                            session: profileSession!,
                        });
                        await new Promise((resolve) => setTimeout(resolve, 150));
                    }
                };
                await Promise.allSettled([worker(), worker()]);
            })().catch(() => undefined);
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json({
            messageId: outgoing.waMessageId || outgoing.id,
            readCount: readers.length,
            readers,
        });
    } catch (error) {
        logger.warn(
            { code: (error as { code?: unknown })?.code },
            'Failed to load outgoing message read receipts',
        );
        return res.status(500).json({ message: 'Failed to load message readers' });
    }
};

/**
 * Get reaction metadata for one open Inbox conversation. This endpoint is
 * deliberately separate from the Inbox list so a reaction failure can never
 * prevent incoming/outgoing messages from loading.
 */
export const getInboxConversationReactions: RequestHandler = async (req, res) => {
    try {
        const deviceUuid = req.params.deviceId;
        const conversationJid =
            typeof req.query.conversationJid === 'string'
                ? req.query.conversationJid.trim()
                : '';

        if (!isUUID(deviceUuid) || !conversationJid) {
            return res.status(400).json({ message: 'Invalid reaction query' });
        }

        const device = await prisma.device.findFirst({
            where: {
                id: deviceUuid,
                ...accessibleDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
            },
            select: {
                pkId: true,
                id: true,
                phone: true,
                sessions: {
                    where: { id: { contains: 'config' } },
                    select: { sessionId: true },
                    orderBy: { pkId: 'desc' },
                    take: 1,
                },
            },
        });
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const reactions = await getConversationMessageReactions(
            device.pkId,
            conversationJid,
        );
        const ownPhone = String(device.phone || '').replace(/\D/g, '');
        const ownJid = ownPhone ? `${ownPhone}@s.whatsapp.net` : null;
        const getProfileJid = (reaction: (typeof reactions)[number]) => {
            if (reaction.reactorJid === 'me') return ownJid;
            const phone = String(reaction.reactorPhone || '').replace(/\D/g, '');
            return phone ? `${phone}@s.whatsapp.net` : reaction.reactorJid;
        };
        const reactorJids = [
            ...new Set(
                reactions
                    .map(getProfileJid)
                    .filter((jid) =>
                        Boolean(jid)
                        && !jid!.endsWith('@lid')
                        && !jid!.endsWith('@g.us'),
                    ),
            ),
        ] as string[];
        const profileSummaries = await getInboxProfileCacheSummaries(
            device.pkId,
            reactorJids,
        );
        const reactionsWithProfiles = reactions.map((reaction) => {
            const profileJid = getProfileJid(reaction);
            const eligible = Boolean(profileJid && reactorJids.includes(profileJid));
            const summary = eligible && profileJid
                ? profileSummaries.get(profileJid)
                : undefined;
            return {
                ...reaction,
                reactorProfilePicUrl: eligible && profileJid
                    ? createInboxProfileUrl(device.id, profileJid)
                    : null,
                reactorProfileStatus: summary?.status
                    || (eligible ? 'pending' : 'unavailable'),
            };
        });

        const sessionId = device.sessions[0]?.sessionId;
        let profileSession: ReturnType<typeof getInstance> | null = null;
        if (sessionId && verifyInstance(sessionId)) {
            try {
                profileSession = getInstance(sessionId);
            } catch {
                profileSession = null;
            }
        }
        if (profileSession && reactorJids.length > 0) {
            const now = Date.now();
            const refreshQueue = reactorJids.filter((jid) => {
                const summary = profileSummaries.get(jid);
                if (!summary) return true;
                if (summary.nextRetryAt && summary.nextRetryAt.getTime() > now) return false;
                return !summary.expiresAt || summary.expiresAt.getTime() <= now;
            });

            void (async () => {
                const worker = async () => {
                    while (refreshQueue.length > 0) {
                        const jid = refreshQueue.shift();
                        if (!jid) return;
                        await refreshInboxProfileCache({
                            deviceId: device.pkId,
                            jid,
                            session: profileSession!,
                        });
                        await new Promise((resolve) => setTimeout(resolve, 150));
                    }
                };
                await Promise.allSettled([worker(), worker()]);
            })().catch(() => undefined);
        }

        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json(reactionsWithProfiles);
    } catch (error) {
        // Reaction metadata is optional. Keep the chat usable if its migration
        // has not reached a deployment yet or the table is temporarily down.
        logger.warn(
            { code: (error as { code?: unknown })?.code },
            'Failed to load conversation reaction metadata',
        );
        res.setHeader('Cache-Control', 'no-store');
        return res.status(200).json([]);
    }
};
