import { RequestHandler } from 'express';
import { generateUuid } from '../utils/keyGenerator';
import prisma from '../utils/db';
import logger from '../config/logger';
import { generateSlug } from '../utils/slug';
import { useDevice } from '../utils/quota';
import fs from 'fs';
import schedule from 'node-schedule';
import { isUUID } from '../utils/uuidChecker';

export const getDevices: RequestHandler = async (req, res) => {
    const pkId = req.authenticatedUser.pkId;
    const privilegeId = req.privilege.pkId;

    try {
        const devices = await prisma.device.findMany({
            where: {
                userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? pkId : undefined,
            },
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
    const pkId = req.authenticatedUser.pkId;

    try {
        // const labels = await prisma.device.findMany({
        //     where: { userId: pkId },
        //     select: {
        //         DeviceLabel: {
        //             select: {
        //                 label: {
        //                     select: { name: true },
        //                 },
        //             },
        //         },
        //     },
        // });

        // const newLabels = labels.flatMap((item) => item.DeviceLabel.map((obj) => obj.label.name));
        const labels = await prisma.label.findMany({
            where: { DeviceLabel: { some: { device: { userId: pkId } } } },
        });

        res.status(200).json(labels.map((label) => label.name));
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

        // back here: get session logs
        const device = await prisma.device.findUnique({
            where: {
                id: deviceId,
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

            await transaction.label.update({
                where: { slug: `device${existingDevice.name}` },
                data: {
                    name: `device_${updatedDevice.name}`,
                    slug: generateSlug(`device_${updatedDevice.name}`),
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

            await prisma.contact.deleteMany({
                where: {
                    contactDevices: { some: { device: { id: deviceId } } },
                },
            }),
                // back here: delete unused labels regularly
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

            const subDirectoryPath = `media/D${deviceId}`;

            fs.rm(subDirectoryPath, { recursive: true }, (err) => {
                if (err) {
                    console.error(`Error deleting sub-directory: ${err}`);
                } else {
                    console.log(`Sub-directory ${subDirectoryPath} is deleted successfully.`);
                }
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

// back here: set a rule for running the job every day at midnight
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
