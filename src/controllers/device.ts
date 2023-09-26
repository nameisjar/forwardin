import { RequestHandler } from 'express';
import { generateApiKey } from '../utils/apiKeyGenerator';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateSlug } from '../utils/slug';

export const getDevices: RequestHandler = async (req, res) => {
    const pkId = req.user.pkId;

    try {
        const devices = await prisma.device.findMany({
            where: { userId: pkId },
        });

        res.status(200).json(devices);
    } catch (error) {
        logger.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createDevice: RequestHandler = async (req, res) => {
    const { name, labels } = req.body;
    const apiKey = generateApiKey();
    const pkId = req.user.pkId;

    // back here: what's severId?
    // back here: get phone from session!
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
            select: {
                name: true,
                apiKey: true,
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
            if (labels && labels.length === 0) {
                await transaction.label.deleteMany({
                    where: {
                        DeviceLabel: {
                            some: {
                                deviceId: updatedDevice.pkId,
                            },
                        },
                    },
                });
            } else if (labels && labels.length > 0) {
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
            }
        });
        res.status(200).json({ message: 'Device updated successfully' });
    } catch (error) {
        logger.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteDevice: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.params.deviceId;

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

        res.status(200).json({ message: 'Device deleted successfully' });
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
