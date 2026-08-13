import { RequestHandler } from 'express';
import { generateUuid } from '../utils/keyGenerator';
import prisma, { serializePrisma } from '../utils/db';
import logger from '../config/logger';
import { generateSlug } from '../utils/slug';
import { useDevice } from '../utils/quota';
import fs from 'fs';
import path from 'path';
import schedule from 'node-schedule';
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
    serializeInboxMediaPath,
    verifyInboxMediaToken,
    verifyInboxProfileToken,
} from '../utils/inboxMedia';
import {
    getInboxProfileCache,
    getInboxProfileCacheSummaries,
    refreshInboxProfileCache,
} from '../services/inboxProfileCache';
import { decryptIncomingMessage } from '../utils/messageEncryption';
import {
    deleteAllDeviceReactions,
    deleteConversationReactions,
    getConversationMessageReactions,
} from '../services/messageReaction';
import { cleanupMediaFilesIfUnreferenced } from '../services/mediaCleanup';
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
        const mediaCleanup = await cleanupMediaFilesIfUnreferenced(
            [...incomingMedia, ...outgoingMedia].map((item) => item.mediaPath),
            'delete-inbox-conversation',
        );

        const deletedCount = incomingResult.count + outgoingResult.count;

        res.status(200).json({
            message: `Berhasil menghapus ${deletedCount} pesan dari ${from}`,
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

        const { to, limit = '50' } = req.query;
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

        // Fetch outgoing messages
        const messages = await prisma.outgoingMessage.findMany({
            where,
            orderBy: { createdAt: 'desc' }, // ✅ DESC untuk ambil yang TERBARU dulu
            take: parseInt(limit as string) || 50,
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
        const decryptedMessages = decryptOutgoingMessages(messages);

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
                broadcastType: true,
                contact: {
                    select: { firstName: true, lastName: true, phone: true, colorCode: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        const { decryptOutgoingMessages } = await import('../utils/messageEncryption');
        const decryptedMessages = decryptOutgoingMessages(latestMessages);
        const recipientJids = [...new Set(decryptedMessages.map((message) => message.to))];
        const recipientPhones = [
            ...new Set(
                recipientJids
                    .filter((jid) => !jid.includes('@g.us') && !jid.includes('@lid'))
                    .map((jid) => jid.split('@')[0].replace(/\D/g, ''))
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
                      select: {
                          firstName: true,
                          lastName: true,
                          phone: true,
                          colorCode: true,
                      },
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
                              select: {
                                  firstName: true,
                                  lastName: true,
                                  phone: true,
                                  colorCode: true,
                              },
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
                const phone = message.to.split('@')[0].replace(/\D/g, '');
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
 * Serve persisted Inbox media through a regular HTTPS URL. The URL contains an
 * HMAC token and can therefore be used by img/video elements without exposing a
 * user JWT or a database data URL to the browser.
 */
export const getInboxMedia: RequestHandler = async (req, res) => {
    try {
        const { deviceId, messageId } = req.params;
        const token = typeof req.query.token === 'string' ? req.query.token : '';
        if (!isUUID(deviceId) || !token || !verifyInboxMediaToken(deviceId, messageId, token)) {
            return res.status(404).end();
        }

        const message = await prisma.incomingMessage.findFirst({
            where: {
                id: messageId,
                device: { id: deviceId },
            },
            select: { mediaPath: true },
        });
        const storedMedia = message?.mediaPath;
        if (!storedMedia) return res.status(404).end();

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

        const {
            page = 1,
            pageSize = 25,
            phoneNumber,
            message,
            contactName,
            conversationJid,
        } = req.query;
        const requestedPage = Math.max(1, Number(page) || 1);
        const requestedPageSize = Math.min(50, Math.max(1, Number(pageSize) || 25));
        const directConversationJid = typeof conversationJid === 'string'
            ? conversationJid.trim()
            : '';

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
        const [incomingGroups, outgoingGroups] = await Promise.all([
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
        ]);

        // Pagination must operate on conversations, not individual messages.
        // Otherwise a busy sender can occupy an entire page and the same chat
        // appears split or disappears when the user changes pages.
        const conversationIndex = new Map<
            string,
            { latestAt: Date; incomingCount: number; outgoingCount: number }
        >();
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
        const totalConversations = orderedConversationKeys.length;
        const totalPages = Math.max(1, Math.ceil(totalConversations / requestedPageSize));
        const currentPage = Math.min(requestedPage, totalPages);
        const offset = (currentPage - 1) * requestedPageSize;
        const conversationKeys = orderedConversationKeys.slice(
            offset,
            offset + requestedPageSize,
        );

        // Keep enough history for the detail modal while bounding the response.
        // Profile/media binaries are served by signed URLs, so they are not
        // duplicated in this JSON response.
        const messagesByConversation = await Promise.all(
            conversationKeys.map((from) =>
                prisma.incomingMessage.findMany({
                    take: 100,
                    where: { ...whereClause, from },
                    include: {
                        contact: {
                            select: {
                                firstName: true,
                                lastName: true,
                                phone: true,
                                colorCode: true,
                            },
                        },
                    },
                    orderBy: { receivedAt: 'desc' },
                }),
            ),
        );
        const messages = messagesByConversation.flat();
        const totalMessages = [...conversationIndex.values()].reduce(
            (sum, item) => sum + item.incomingCount + item.outgoingCount,
            0,
        );

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
        const serialized = normalizedMessages.map((message) => {
            const item = serializePrisma(decryptIncomingMessage(message));
            if (message.from.endsWith('@g.us') && !item.groupName) {
                item.groupName = inboxGroupNameByJid.get(message.from) || null;
            }
            item.mediaPath = serializeInboxMediaPath(
                message.mediaPath,
                deviceUuid,
                message.id,
            );
            const profileCache = profileCacheByJid.get(message.from);
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
                currentPage,
                totalPages,
                hasMore,
                conversationKeys,
            },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
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
        const getProfileJid = (reactorJid: string) =>
            reactorJid === 'me' ? ownJid : reactorJid;
        const reactorJids = [
            ...new Set(
                reactions
                    .map((reaction) => getProfileJid(reaction.reactorJid))
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
            const profileJid = getProfileJid(reaction.reactorJid);
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
