/* eslint-disable @typescript-eslint/no-explicit-any */
import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getRandomColor } from '../utils/profilePic';
import { generateSlug } from '../utils/slug';
import logger from '../config/logger';
import { useContact } from '../utils/quota';
import { memoryUpload } from '../config/multer';
import ExcelJS from 'exceljs';
import axios from 'axios';
import { isUUID } from '../utils/uuidChecker';
import fs from 'fs';

// Helper to format phone number (08 -> 628)
const formatPhoneNumber = (phone: any): string => {
    if (!phone) return '';
    let clean = String(phone).replace(/[\s\-\(\)\+]/g, '');
    if (clean.startsWith('0')) {
        clean = '62' + clean.slice(1);
    } else if (clean.startsWith('8')) {
        clean = '62' + clean;
    }
    return clean;
};

export const createContact: RequestHandler = async (req, res) => {
    try {
        const { firstName, lastName, email, gender, dob, labels, deviceId } = req.body;
        const phone = formatPhoneNumber(req.body.phone);

        if (!firstName || !phone || !deviceId) {
            return res.status(400).json({ message: 'firstName, phone, and deviceId are required' });
        }

        const pkId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        const existingContact = await prisma.contact.findFirst({
            where: {
                phone,
                AND: {
                    contactDevices: {
                        some: {
                            device: {
                                id: deviceId,
                                userId:
                                    privilegeId !== Number(process.env.SUPER_ADMIN_ID)
                                        ? pkId
                                        : undefined,
                            },
                        },
                    },
                },
            },
        });

        if (existingContact) {
            return res.status(400).json({
                message: 'Contact with this phone number already exists in your device',
            });
        }

        const existingDevice = await prisma.device.findUnique({
            where: {
                id: deviceId,
            },
            include: { sessions: { select: { sessionId: true } } },
        });

        if (!existingDevice) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const sessionId = existingDevice.sessions[0]?.sessionId;

        const created = await prisma.$transaction(async (transaction) => {
            const createdContact = await transaction.contact.create({
                data: {
                    firstName,
                    lastName,
                    phone,
                    email,
                    gender,
                    dob: dob ? new Date(dob) : null,
                    colorCode: getRandomColor(),
                },
            });

            const inputLabels: string[] = Array.isArray(labels)
                ? labels.filter((l: any) => typeof l === 'string' && l.trim().length > 0)
                : [];
            if (inputLabels.length > 0) {
                const labelIds: number[] = [];

                for (const labelName of inputLabels) {
                    const slug = generateSlug(labelName);
                    const createdLabel = await transaction.label.upsert({
                        where: { slug },
                        create: { name: labelName, slug },
                        update: { name: labelName, slug },
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

            if (sessionId) {
                await transaction.outgoingMessage.updateMany({
                    where: {
                        to: phone + '@s.whatsapp.net',
                        sessionId,
                    },
                    data: { contactId: createdContact.pkId },
                });

                await transaction.incomingMessage.updateMany({
                    where: {
                        from: phone + '@s.whatsapp.net',
                        sessionId,
                    },
                    data: { contactId: createdContact.pkId },
                });
            }

            await transaction.contactDevice.create({
                data: {
                    contactId: createdContact.pkId,
                    deviceId: existingDevice.pkId,
                },
            });

            return { contactId: createdContact.id, contactName: createdContact.firstName };
        });

        res.status(200).json({
            message: 'Contact created successfully',
            contactId: created.contactId,
            contactName: created.contactName,
        });
    } catch (error: unknown) {
        logger.error(error);

        if (error instanceof Error) {
            if (error.message.includes('Unique constraint')) {
                return res.status(400).json({
                    message: 'Contact with this phone number already exists',
                });
            }
            if (error.message.includes('Foreign key constraint')) {
                return res.status(400).json({
                    message: 'Invalid device ID provided',
                });
            }
        }

        const errorMessage = error instanceof Error ? error.message : 'Unknown error occurred';
        res.status(500).json({
            message: 'Internal server error',
            error: process.env.NODE_ENV === 'development' ? errorMessage : undefined,
        });
    }
};

export const importContacts: RequestHandler = async (req, res) => {
    const privilegeId = req.privilege.pkId;

    try {
        memoryUpload.single('file')(req, res, async (err) => {
            const results: any[] = [];
            const errors: any[] = [];
            if (err) {
                const message = 'An error occurred during file upload';
                logger.error(err, message);
                return res.status(500).json({ error: message });
            }
            if (!req.file) {
                return res.status(400).json({ message: 'No file uploaded' });
            }
            const workbook = new ExcelJS.Workbook();
            const buffer = req.file.buffer;
            const deviceId = req.body.deviceId;
            const groupName = req.body.groupName || new Date().toISOString().slice(0, 10);

            await workbook.xlsx.load(buffer);
            const worksheet = workbook.getWorksheet(1);
            if (!worksheet) {
                return res.status(400).json({ message: 'No worksheet found' });
            }

            const contacts: any[] = [];

            worksheet.eachRow((row, rowNumber) => {
                if (rowNumber === 1) {
                    return;
                }

                const firstName = row.getCell(1).value;
                const lastName = row.getCell(2).value;
                const phone = formatPhoneNumber(row.getCell(3).value);
                const email = row.getCell(4).value;
                const gender = row.getCell(5).value;
                const dob = row.getCell(6).value?.toString();
                const labels = row.getCell(7).value;
                
                if (!firstName || !phone) {
                    errors.push({ 
                        row: rowNumber, 
                        error: 'firstName and phone values are required',
                        data: { firstName, phone }
                    });
                    return;
                }

                const contact = {
                    firstName,
                    lastName,
                    phone,
                    email,
                    gender,
                    dob,
                    labels,
                    colorCode: getRandomColor(),
                };
                contacts.push(contact);
            });

            if (contacts.length === 0) {
                return res.status(400).json({ 
                    message: 'No valid contacts found in the file',
                    errors 
                });
            }

            const pkId = req.authenticatedUser.pkId;
            
            // Optimization: Fetch device once outside the loop
            const existingDevice = await prisma.device.findUnique({
                where: {
                    id: deviceId,
                },
                include: { sessions: { select: { sessionId: true } } },
            });

            if (!existingDevice) {
                return res.status(404).json({ message: 'Device not found' });
            }
            // Note: Session might be null/undefined if device is not connected, but we should allow import anyway
            // Just skip message updates if no session.
            const sessionId = existingDevice.sessions?.[0]?.sessionId;

            // Fix: Create group once before processing contacts
            let group: { pkId: number } | null = null;
            try {
                group = await prisma.group.create({
                    data: {
                        name: `IMPORT_${groupName}`,
                        type: 'import',
                        user: { connect: { pkId } },
                    },
                });
            } catch (groupError) {
                logger.error(groupError, 'Failed to create import group');
                // Proceed without group if creation fails
            }
            
            for (let index = 0; index < contacts.length; index++) {
                const email = contacts[index].email?.text ?? contacts[index].email;
                try {
                    // Check existence
                    const existingContact = await prisma.contact.findFirst({
                        where: {
                            phone: contacts[index].phone,
                            AND: {
                                contactDevices: {
                                    some: {
                                        device: {
                                            id: deviceId,
                                            userId:
                                                privilegeId !== Number(process.env.SUPER_ADMIN_ID)
                                                    ? pkId
                                                    : undefined,
                                        },
                                    },
                                },
                            },
                        },
                    });

                    if (existingContact) {
                        throw new Error(
                            `Contact with phone ${contacts[index].phone} already exists`,
                        );
                    }
                    
                    await prisma.$transaction(async (transaction) => {
                        const createdContact = await transaction.contact.create({
                            data: {
                                firstName: contacts[index].firstName,
                                lastName: contacts[index].lastName,
                                phone: contacts[index].phone,
                                email,
                                gender: contacts[index].gender,
                                dob: contacts[index].dob ? new Date(contacts[index].dob) : null,
                                colorCode: getRandomColor(),
                            },
                        });

                        // Add to group if group exists
                        if (group) {
                            await transaction.contactGroup.create({
                                data: {
                                    groupId: group.pkId,
                                    contactId: createdContact.pkId,
                                },
                            });
                        }

                        // Process Labels
                        const labelsArr = [
                            ...((typeof contacts[index].labels === 'string'
                                ? contacts[index].labels.split(',')
                                : Array.isArray(contacts[index].labels)
                                ? contacts[index].labels
                                : []) as string[]),
                        ]
                            .map((l) => (typeof l === 'string' ? l.trim() : ''))
                            .filter((l) => l.length > 0);
                            
                        if (labelsArr.length > 0) {
                            const labelIds: number[] = [];

                            for (const labelName of labelsArr) {
                                const slug = generateSlug(labelName);
                                const createdLabel = await transaction.label.upsert({
                                    where: { slug },
                                    create: { name: labelName, slug },
                                    update: { name: labelName, slug },
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

                        // Link to Device
                        await transaction.contactDevice.create({
                            data: {
                                contactId: createdContact.pkId,
                                deviceId: existingDevice.pkId,
                            },
                        });

                        // Update messages history if session exists
                        if (sessionId) {
                            await transaction.outgoingMessage.updateMany({
                                where: {
                                    to: contacts[index].phone + '@s.whatsapp.net',
                                    sessionId: sessionId,
                                },
                                data: {
                                    contactId: createdContact.pkId,
                                },
                            });

                            await transaction.incomingMessage.updateMany({
                                where: {
                                    from: contacts[index].phone + '@s.whatsapp.net',
                                    sessionId: sessionId,
                                },
                                data: {
                                    contactId: createdContact.pkId,
                                },
                            });
                        }

                        results.push({ index, createdContact });
                    });
                } catch (error: unknown) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : 'An error occurred during import contacts';
                    errors.push({ index, phone: contacts[index].phone, error: message });
                }
            }
            res.status(200).json({ results, errors });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const { firstName, lastName, email, gender, dob, labels, deviceId } = req.body;
        const phone = req.body.phone ? formatPhoneNumber(req.body.phone) : undefined;

        if (!isUUID(contactId)) {
            return res.status(400).json({ message: 'Invalid contactId' });
        }

        await prisma.$transaction(async (transaction) => {
            const existingContact = await transaction.contact.findUnique({
                where: { id: contactId },
                include: { contactDevices: { select: { id: true } } },
            });

            if (!existingContact) {
                throw new Error('Contact not found');
            }

            const updatedContact = await transaction.contact.update({
                where: { pkId: existingContact.pkId },
                data: {
                    firstName,
                    lastName,
                    phone,
                    email,
                    gender,
                    dob: dob ? new Date(dob) : null,
                    updatedAt: new Date(),
                },
            });

            if (deviceId) {
                const existingDevice = await transaction.device.findUnique({
                    where: { id: deviceId },
                });
                if (!existingDevice) {
                    throw new Error('Device not found');
                }

                if (existingContact.contactDevices.length > 0) {
                    await transaction.contactDevice.update({
                        where: { id: existingContact.contactDevices[0].id },
                        data: { deviceId: existingDevice.pkId },
                    });
                } else {
                    await transaction.contactDevice.create({
                        data: { contactId: updatedContact.pkId, deviceId: existingDevice.pkId },
                    });
                }
            }

            if (Array.isArray(labels)) {
                await transaction.contactLabel.deleteMany({
                    where: { contactId: updatedContact.pkId },
                });

                const cleanLabels: string[] = labels.filter(
                    (l: any) => typeof l === 'string' && l.trim().length > 0,
                );

                for (const labelName of cleanLabels) {
                    const slug = generateSlug(labelName);
                    const lbl = await transaction.label.upsert({
                        where: { slug },
                        create: { name: labelName, slug },
                        update: { name: labelName, slug },
                    });
                    await transaction.contactLabel.create({
                        data: { contactId: updatedContact.pkId, labelId: lbl.pkId },
                    });
                }
            }
        });

        res.status(200).json({ message: 'Contact updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const syncGoogle: RequestHandler = async (req, res) => {
    const accessToken = req.body.accessToken;
    const deviceId = req.body.deviceId;
    const privilegeId = req.privilege.pkId;
    const pkId = req.authenticatedUser.pkId;

    const downloadEndpoint =
        'https://people.googleapis.com/v1/people/me/connections?personFields=names,phoneNumbers,emailAddresses,birthdays,genders,photos';
    const uploadEndpoint = 'https://people.googleapis.com/v1/people:createContact';

    const downloadResponse = await axios.get(downloadEndpoint, {
        headers: {
            Authorization: `Bearer ${accessToken}`,
        },
    });

    try {
        if (downloadResponse.status == 200) {
            const connections = downloadResponse.data.connections || [];
            const googleContactsData: any[] = [];
            const results: any[] = [];
            const errors: any[] = [];

            const existingGoogleContacts: string[] = [];
            connections.map((contact: any) =>
                existingGoogleContacts.push(
                    contact.phoneNumbers && contact.phoneNumbers.length > 0
                        ? contact.phoneNumbers[0].canonicalForm?.replace(/\+/g, '')
                        : contact.names && contact.names.length > 0
                        ? contact.names[0].displayNameLastFirst.split(',')[0]
                        : '',
                ),
            );

            const forwardinContactsData = await prisma.contact.findMany({
                where: { phone: { notIn: existingGoogleContacts } },
            });

            for (let index = 0; index < forwardinContactsData.length; index++) {
                const newContactData = {
                    names: [
                        {
                            givenName: forwardinContactsData[index].firstName,
                            familyName: 'Forwardin',
                        },
                    ],
                    phoneNumbers: [
                        {
                            value: forwardinContactsData[index].phone,
                            type: 'mobile',
                        },
                    ],
                };

                try {
                    const uploadResponse = await axios.post(uploadEndpoint, newContactData, {
                        headers: {
                            Authorization: `Bearer ${accessToken}`,
                        },
                    });
                    results.push({
                        index,
                        uploaded: uploadResponse.data.phoneNumbers[0]?.canonicalForm || '',
                    });
                } catch (error) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : 'An error occurred during upload contacts';
                    errors.push({ index, error: message });
                }
            }

            for (const contact of connections) {
                const phones = contact.phoneNumbers || [];
                let phone =
                    phones && phones.length > 0
                        ? phones[0].canonicalForm?.replace(/\+/g, '')
                        : contact.names && contact.names.length > 0
                        ? contact.names[0].displayNameLastFirst.split(',')[0]
                        : '';
                
                phone = formatPhoneNumber(phone);

                const firstName = contact.names ? contact.names[0].displayName : phone;

                const data = {
                    firstName,
                    phone,
                };
                googleContactsData.push(data);
            }

            for (let index = 0; index < googleContactsData.length; index++) {
                try {
                    const existingContact = await prisma.contact.findFirst({
                        where: {
                            phone: googleContactsData[index].phone,
                            AND: {
                                contactDevices: {
                                    some: {
                                        device: {
                                            id: deviceId,
                                            userId:
                                                privilegeId !== Number(process.env.SUPER_ADMIN_ID)
                                                    ? pkId
                                                    : undefined,
                                        },
                                    },
                                },
                            },
                        },
                    });

                    if (existingContact) {
                        throw new Error(
                            'Contact with this email or phone number already exists in your contact',
                        );
                    }
                    await prisma.$transaction(async (transaction) => {
                        const createdContact = await transaction.contact.create({
                            data: {
                                firstName: googleContactsData[index].firstName,
                                phone: googleContactsData[index].phone,
                                colorCode: getRandomColor(),
                            },
                        });

                        const existingDevice = await transaction.device.findUnique({
                            where: {
                                id: deviceId,
                            },
                            include: { sessions: { select: { sessionId: true } } },
                        });

                        if (!existingDevice) {
                            throw new Error('Device not found');
                        }
                        if (!existingDevice.sessions[0]) {
                            throw new Error('Session not found');
                        }

                        const labels = ['sync_google', `device_${existingDevice.name}`];
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
                                deviceId: existingDevice.pkId,
                            },
                        });

                        await transaction.outgoingMessage.updateMany({
                            where: {
                                to: googleContactsData[index].phone + '@s.whatsapp.net',
                                sessionId: existingDevice.sessions[0].sessionId,
                            },
                            data: {
                                contactId: createdContact.pkId,
                            },
                        });

                        await transaction.incomingMessage.updateMany({
                            where: {
                                from: googleContactsData[index].phone + '@s.whatsapp.net',
                                sessionId: existingDevice.sessions[0].sessionId,
                            },
                            data: {
                                contactId: createdContact.pkId,
                            },
                        });

                        results.push({ index, downloaded: createdContact });
                    });
                } catch (error: unknown) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : 'An error occurred during download contacts';
                    errors.push({ index, error: message });
                }
            }

            res.status(200).json({ results, errors });
        } else {
            const errorMessage = downloadResponse.data?.error?.message || 'Unknown Error';
            res.status(downloadResponse.status).json({ error: errorMessage });
        }
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
