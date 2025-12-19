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

        if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
            return res.status(400).json({ message: 'Invalid deviceIds' });
        }

        // Import WhatsApp functions for cleanup
        const { deleteInstance, verifyInstance } = require('../whatsapp');

        const devicePromises = deviceIds.map(async (deviceId: string) => {
            const device = await prisma.device.findUnique({
                where: {
                    id: deviceId,
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

schedule.scheduleJob('*', async () => {
    try {
        const deviceLabels = await prisma.deviceLabel.findMany({ select: { labelId: true } });
        const contactLabels = await prisma.contactLabel.findMany({
            select: { labelId: true, contactId: true },
        });
        const labels = deviceLabels.map((dl) => dl.labelId);
        contactLabels.map((cl) => labels.push(cl.labelId));

        const contactDevices = await prisma.contactDevice.findMany({
            select: { deviceId: true, contactId: true },
        });
        const contactGroups = await prisma.contactGroup.findMany({
            select: { groupId: true, contactId: true },
        });
        const contacts = contactDevices.map((cd) => cd.contactId);
        contactGroups.map((cg) => contacts.push(cg.contactId));

        await prisma.label.deleteMany({ where: { pkId: { notIn: labels } } });
        await prisma.contact.deleteMany({ where: { pkId: { notIn: contacts } } });
        logger.info('Database cleanup executed successfully.');
    } catch (error) {
        logger.error('Error executing database cleanup:', error);
    }
});
