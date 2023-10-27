import { RequestHandler } from 'express';
import { generateUuid } from '../utils/keyGenerator';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateSlug } from '../utils/slug';
import { useDevice } from '../utils/quota';

export const getDevices: RequestHandler = async (req, res) => {
    const pkId = req.prismaUser.pkId;

    try {
        const devices = await prisma.device.findMany({
            where: { userId: pkId },
            include: {
                DeviceLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
            },
        });

        res.status(200).json(devices);
    } catch (error) {
        logger.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getDeviceLabels: RequestHandler = async (req, res) => {
    const pkId = req.prismaUser.pkId;

    try {
        const labels = await prisma.device.findMany({
            where: { userId: pkId },
            select: {
                DeviceLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
            },
        });

        const newLabels = labels.flatMap((item) => item.DeviceLabel.map((obj) => obj.label.name));
        res.status(200).json(newLabels);
    } catch (error) {
        logger.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createDevice: RequestHandler = async (req, res) => {
    const { name, labels } = req.body;
    const apiKey = generateUuid();
    const pkId = req.prismaUser.pkId;
    const subscription = req.subscription;

    // back here: what's severId?
    try {
        await prisma.$transaction(async (transaction) => {
            const createdDevice = await transaction.device.create({
                data: {
                    apiKey,
                    name,
                    serverId: 1,
                    user: { connect: { pkId } },
                },
            });

            useDevice(transaction, subscription);

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
        logger.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getDevice: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;

        // back here: get session logs
        const device = await prisma.device.findUnique({
            where: {
                id: deviceId,
            },
            include: {
                sessions: true,
                DeviceLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
            },
        });

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

        await prisma.$transaction(async (transaction) => {
            const existingDevice = await transaction.device.findUnique({
                where: {
                    id: deviceId,
                },
            });

            if (!existingDevice) {
                return res.status(404).json({ message: 'Device not found' });
            }

            // update device
            const updatedDevice = await transaction.device.update({
                where: {
                    pkId: existingDevice.pkId,
                },
                data: {
                    name,
                    updatedAt: new Date(),
                },
            });

            // update labels
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

                // update device-label
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
        logger.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteDevices: RequestHandler = async (req, res) => {
    try {
        const deviceIds = req.body.deviceIds;

        const devicePromises = deviceIds.map(async (deviceId: string) => {
            if (!isValidUUID(deviceId)) {
                return res.status(400).json({ message: 'Invalid deviceId format' });
            }
            const deletedDevice = await prisma.device.delete({
                where: {
                    id: deviceId,
                },
            });

            await prisma.label.deleteMany({
                where: {
                    NOT: {
                        DeviceLabel: {
                            some: {
                                deviceId: { not: deletedDevice.pkId },
                            },
                        },
                    },
                },
            });
        });

        await Promise.all(devicePromises);

        res.status(200).json({ message: 'Device(s) deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

function isValidUUID(uuid: string): boolean {
    const uuidPattern =
        /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    return uuidPattern.test(uuid);
}
