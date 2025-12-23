import { RequestHandler } from 'express';
import { generateUuid } from '../utils/keyGenerator';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateSlug } from '../utils/slug';
import { useDevice } from '../utils/quota';
import fs from 'fs';
import schedule from 'node-schedule';
import { isUUID } from '../utils/uuidChecker';
import { generateDeviceAccessToken } from '../utils/jwtGenerator';
import { verifyInstance } from '../whatsapp';
import { 
    getDeviceHealth, 
    pauseDevice, 
    resumeDevice, 
    checkAutoResume,
    cleanupOldSignals,
} from '../services/signalDetector';

export const getDevices: RequestHandler = async (req, res) => {
    const pkId = req.authenticatedUser.pkId;

    try {
        const devices = await prisma.device.findMany({
            where: {
                userId: pkId,
            },
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
                }
            },
        });

        // 🆕 Validasi status device: jika status 'open' tapi tidak ada instance aktif, update ke 'close'
        const validatedDevices = await Promise.all(
            devices.map(async (device) => {
                const sessionId = device.sessions[0]?.sessionId;
                const dbStatus = device.status;

                // Jika status di DB adalah 'open', validasi apakah instance benar-benar aktif
                if (dbStatus === 'open' && sessionId) {
                    const isInstanceActive = verifyInstance(sessionId);
                    
                    if (!isInstanceActive) {
                        // Instance tidak aktif, update status di DB ke 'close'
                        logger.warn(
                            { deviceId: device.id, sessionId },
                            'Device status mismatch: DB says open but no active instance. Updating to close.'
                        );
                        
                        await prisma.device.update({
                            where: { pkId: device.pkId },
                            data: { status: 'close', updatedAt: new Date() }
                        });

                        // Return device dengan status yang sudah dikoreksi
                        const { sessions, ...deviceWithoutSessions } = device;
                        return { ...deviceWithoutSessions, status: 'close' };
                    }
                } else if (dbStatus === 'open' && !sessionId) {
                    // Status open tapi tidak ada session sama sekali
                    logger.warn(
                        { deviceId: device.id },
                        'Device status mismatch: DB says open but no session found. Updating to close.'
                    );
                    
                    await prisma.device.update({
                        where: { pkId: device.pkId },
                        data: { status: 'close', updatedAt: new Date() }
                    });

                    const { sessions, ...deviceWithoutSessions } = device;
                    return { ...deviceWithoutSessions, status: 'close' };
                }

                // Remove sessions from response (tidak perlu dikirim ke frontend)
                const { sessions, ...deviceWithoutSessions } = device;
                return deviceWithoutSessions;
            })
        );

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
            where: { DeviceLabel: { some: { device: { userId: pkId } } } },
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
        const isSuperAdmin = req.privilege?.pkId === Number(process.env.SUPER_ADMIN_ID);

        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...(isSuperAdmin ? {} : { userId: userPkId }),
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const apiKey = generateUuid();

        await prisma.device.update({
            where: { pkId: device.pkId },
            data: {
                apiKey,
            },
        });
        res.status(200).json({ apiKey });
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
        const isSuperAdmin = req.privilege?.pkId === Number(process.env.SUPER_ADMIN_ID);

        const device = await prisma.device.findFirst({
            where: {
                id: deviceId,
                ...(isSuperAdmin ? {} : { userId: userPkId }),
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
            const existingDevice = await transaction.device.findUnique({
                where: {
                    id: deviceId,
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

export const deleteDevices: RequestHandler = async (req, res) => {
    try {
        const deviceIds = req.body.deviceIds;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;
        const isSuperAdmin = privilegeId === Number(process.env.SUPER_ADMIN_ID);

        if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
            return res.status(400).json({ message: 'Invalid deviceIds' });
        }

        // Import WhatsApp functions for cleanup
        const { deleteInstance, verifyInstance } = require('../whatsapp');

        const devicePromises = deviceIds.map(async (deviceId: string) => {
            // Verify ownership before deletion
            const device = await prisma.device.findFirst({
                where: {
                    id: deviceId,
                    ...(isSuperAdmin ? {} : { userId }),
                },
            });

            if (!device) {
                return { success: false, deviceId };
            }

            try {
                // Clean up WhatsApp instance if exists
                if (verifyInstance(deviceId)) {
                    // console.log(`Cleaning up WhatsApp instance for device: ${deviceId}`);
                    await deleteInstance(deviceId);
                }
            } catch (error) {
                // console.warn(`Warning: Could not cleanup WhatsApp instance for device ${deviceId}:`, error);
                // Continue with deletion even if instance cleanup fails
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
                prisma.label.deleteMany({
                    where: {
                        NOT: {
                            DeviceLabel: {
                                some: {
                                    deviceId: { not: deletedDevice.pkId },
                                },
                            },
                        },
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
            return { success: true };
        });

        const deviceResults = await Promise.all(devicePromises);
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
                userId: userPkId,
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
                userId: req.authenticatedUser.pkId,
            },
            select: { pkId: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const health = await getDeviceHealth(deviceId);

        if (!health) {
            return res.status(404).json({ message: 'Device health info not found' });
        }

        // Add convenience fields for frontend
        res.status(200).json({
            ...health,
            isPaused: health.healthStatus === 'paused',
            todayMessages: health.todayMessageCount,
            recentRateLimits: health.stats?.rateLimitCount24h || 0,
            recentConnectionErrors: health.stats?.errorCount24h || 0,
            recommendations: health.recommendation ? [health.recommendation] : [],
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
                userId: req.authenticatedUser.pkId,
            },
            select: { pkId: true, healthStatus: true },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        if (device.healthStatus === 'banned') {
            return res.status(400).json({ message: 'Device is banned and cannot be paused' });
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
                userId: req.authenticatedUser.pkId,
            },
            select: { pkId: true, healthStatus: true },
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
                userId: req.authenticatedUser.pkId,
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

// Database cleanup job - every 5 minutes (was: every second '*')
scheduledJobs.push(
    schedule.scheduleJob('*/5 * * * *', async () => {
        try {
            await cleanupOrphanedData();
        } catch (error) {
            logger.error('Error executing database cleanup:', error);
        }
    })
);

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
