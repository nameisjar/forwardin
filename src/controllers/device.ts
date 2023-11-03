import { RequestHandler } from 'express';
import { generateUuid } from '../utils/keyGenerator';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateSlug } from '../utils/slug';
import { useDevice } from '../utils/quota';

export const getDevices: RequestHandler = async (req, res) => {
    const pkId = req.userReq.pkId;
    const privilegeName = req.userReq.privilege.name;

    try {
        const devices = await prisma.device.findMany({
            where: { userId: privilegeName !== 'super admin' ? pkId : undefined },
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
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getDeviceLabels: RequestHandler = async (req, res) => {
    const pkId = req.userReq.pkId;

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
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createDevice: RequestHandler = async (req, res) => {
    const { name, labels } = req.body;
    const apiKey = generateUuid();
    const pkId = req.userReq.pkId;
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
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: handle error inside promise
export const deleteDevices: RequestHandler = async (req, res) => {
    try {
        const deviceIds = req.body.deviceIds;

        if (!deviceIds || !Array.isArray(deviceIds) || deviceIds.length === 0) {
            return res.status(400).json({ message: 'Invalid deviceIds' });
        }

        const devicePromises = deviceIds.map(async (deviceId: string) => {
            const device = await prisma.device.findUnique({
                where: {
                    id: deviceId,
                },
            });

            if (!device) {
                return { success: false, deviceId };
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

            return { success: true };
        });

        // wait for all the Promises to settle (either resolve or reject)
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
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
