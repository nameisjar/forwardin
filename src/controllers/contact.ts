import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getRandomColor } from '../utils/profilePic';
import { generateSlug } from '../utils/slug';

export const createContact: RequestHandler = async (req, res) => {
    try {
        const { firstName, lastName, phone, email, gender, dob, labels, deviceId } = req.body;

        const existingContact = await prisma.contact.findFirst({
            where: {
                OR: [{ email: email }, { phone: phone }],
            },
        });

        if (existingContact) {
            return res
                .status(400)
                .json({ message: 'Contact with this email or phone number already exists' });
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

            await transaction.contactDevice.create({
                data: {
                    contactId: createdContact.pkId,
                    deviceId,
                },
            });
        });

        res.status(200).json({ message: 'Contact created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getContacts: RequestHandler = async (req, res) => {
    const pkId = req.user.pkId;

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
                            select: { name: true },
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
        const { firstName, lastName, phone, email, gender, dob } = req.body;

        const existingContact = await prisma.contact.findUnique({
            where: {
                id: contactId,
            },
        });

        if (!existingContact) {
            return res.status(404).json({ message: 'Contact nout found' });
        }

        await prisma.contact.update({
            where: {
                id: existingContact.id,
            },
            data: {
                firstName,
                lastName,
                phone,
                email,
                gender,
                dob: new Date(dob),
            },
        });

        res.status(200).json({ message: 'Contact updated successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;

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
                id: contactId,
            },
        });

        res.status(200).json({ message: 'Contact deleted successfully' });
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
                pkId: contactId,
            },
        });

        if (!contact) {
            return res.status(404).json({ message: 'Contact not found' });
        }

        const groupPromises = groupIds.map((groupId: number) => {
            return prisma.contactGroup.create({
                data: {
                    groupId,
                    contactId,
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
