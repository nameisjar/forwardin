import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getRandomColor } from '../utils/profilePic';
import { generateSlug } from '../utils/slug';

export const createContact: RequestHandler = async (req, res) => {
    try {
        const { firstName, lastName, phone, email, gender, dob, labels, deviceId } = req.body;

        const pkId = req.prismaUser.pkId;

        const existingContact = await prisma.contact.findFirst({
            where: {
                OR: [{ email: email }, { phone: phone }],
                AND: { contactDevices: { some: { device: { userId: pkId } } } },
            },
        });

        if (existingContact) {
            return res.status(400).json({
                message: 'Contact with this email or phone number already exists in your contact',
            });
        }

        await prisma.$transaction(async (transaction) => {
            const createdContact = await transaction.contact.create({
                data: {
                    firstName,
                    lastName,
                    phone,
                    email,
                    gender,
                    dob: new Date(dob),
                    colorCode: getRandomColor(),
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

                await transaction.contactLabel.createMany({
                    data: labelIds.map((labelId) => ({
                        contactId: createdContact.pkId,
                        labelId: labelId,
                    })),
                    skipDuplicates: true,
                });
            }

            const existingDevice = await transaction.device.findUnique({
                where: {
                    id: deviceId,
                },
            });

            if (!existingDevice) {
                throw new Error('Device not found');
            }

            await transaction.contactDevice.create({
                data: {
                    contactId: createdContact.pkId,
                    deviceId: existingDevice.pkId,
                },
            });
        });

        res.status(200).json({ message: 'Contact created successfully' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const getContacts: RequestHandler = async (req, res) => {
    const pkId = req.prismaUser.pkId;

    try {
        const contacts = await prisma.contact.findMany({
            where: { contactDevices: { some: { device: { userId: pkId } } } },
            include: {
                ContactLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
            },
        });
        res.status(200).json(contacts);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getContactLabels: RequestHandler = async (req, res) => {
    const pkId = req.prismaUser.pkId;

    try {
        const labels = await prisma.contact.findMany({
            where: { contactDevices: { some: { device: { userId: pkId } } } },
            select: {
                ContactLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
            },
        });

        const newLabels = labels.flatMap((item) => item.ContactLabel.map((obj) => obj.label.name));
        res.status(200).json(newLabels);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: display history, and media
export const getContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;

        const contact = await prisma.contact.findUnique({
            where: {
                id: contactId,
            },
            include: {
                ContactLabel: {
                    select: {
                        label: {
                            select: { name: true },
                        },
                    },
                },
                contactDevices: {
                    select: {
                        device: {
                            select: { name: true, id: true },
                        },
                    },
                },
                contactGroups: {
                    select: {
                        group: {
                            select: { name: true },
                        },
                    },
                },
            },
        });

        if (!contact) {
            res.status(404).json({ message: 'Contact not found' });
        }

        res.status(200).json(contact);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const { firstName, lastName, phone, email, gender, dob, labels, deviceId } = req.body;

        await prisma.$transaction(async (transaction) => {
            const existingContact = await prisma.contact.findUnique({
                where: {
                    id: contactId,
                },
                include: {
                    contactDevices: {
                        select: {
                            id: true,
                        },
                    },
                },
            });

            if (!existingContact) {
                return res.status(404).json({ message: 'Contact not found' });
            }

            // update contact
            const updatedContact = await transaction.contact.update({
                where: {
                    pkId: existingContact.pkId,
                },
                data: {
                    firstName,
                    lastName,
                    phone,
                    email,
                    gender,
                    dob: new Date(dob),
                    updatedAt: new Date(),
                },
            });

            // update labels
            if (labels && labels.length > 0) {
                const labelIds: number[] = [];
                const slugs = labels.map((slug: string) => generateSlug(slug));

                await transaction.label.deleteMany({
                    where: {
                        ContactLabel: {
                            some: {
                                contactId: updatedContact.pkId,
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

                // update contact-label
                await transaction.contactLabel.deleteMany({
                    where: {
                        contactId: updatedContact.pkId,
                    },
                });

                await transaction.contactLabel.createMany({
                    data: labelIds.map((labelId) => ({
                        contactId: updatedContact.pkId,
                        labelId: labelId,
                    })),
                    skipDuplicates: true,
                });
            } else {
                await transaction.label.deleteMany({
                    where: {
                        ContactLabel: {
                            some: {
                                contactId: updatedContact.pkId,
                            },
                        },
                    },
                });
            }

            // update device
            const existingDevice = await transaction.device.findUnique({
                where: {
                    id: deviceId,
                },
            });

            if (!existingDevice) {
                throw new Error('Device not found');
            }

            await transaction.contactDevice.update({
                where: { id: existingContact.contactDevices[0].id },
                data: {
                    deviceId: existingDevice.pkId,
                },
            });
        });

        res.status(200).json({ message: 'Contact updated successfully' });
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } catch (error: any) {
        res.status(500).json({ message: error.message });
    }
};

export const deleteContacts: RequestHandler = async (req, res) => {
    try {
        const contactIds = req.body.contactIds;

        const contactPromises = contactIds.map(async (contactId: string) => {
            const existingContact = await prisma.contact.findUnique({
                where: {
                    id: contactId,
                },
            });

            if (!existingContact) {
                return res.status(404).json({ message: 'Contact not found' });
            }

            await prisma.contact.delete({
                where: {
                    pkId: existingContact.pkId,
                },
            });

            await prisma.label.deleteMany({
                where: {
                    NOT: {
                        ContactLabel: {
                            some: {
                                contactId: { not: existingContact.pkId },
                            },
                        },
                    },
                },
            });
        });

        await Promise.all(contactPromises);

        res.status(200).json({ message: 'Device(s) deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const addContactToGroup: RequestHandler = async (req, res) => {
    try {
        const { contactId, groupIds } = req.body;

        if (!contactId || !groupIds || groupIds.length === 0) {
            return res
                .status(400)
                .json({ message: 'Invalid input: contactId and groupIds are required' });
        }

        const contact = await prisma.contact.findUnique({
            where: {
                id: contactId,
            },
        });

        if (!contact) {
            return res.status(404).json({ message: 'Contact not found' });
        }

        const groupPromises = groupIds.map(async (groupId: string) => {
            const group = await prisma.group.findUnique({
                where: {
                    id: groupId,
                },
            });

            if (!group) {
                return res.status(404).json({ message: 'Group not found' });
            }

            return prisma.contactGroup.create({
                data: {
                    groupId: group.pkId,
                    contactId: contact.pkId,
                },
            });
        });

        await Promise.all(groupPromises);

        res.status(200).json({ message: 'Contact added to group(s) successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
