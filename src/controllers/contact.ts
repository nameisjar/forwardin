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

export const createContact: RequestHandler = async (req, res) => {
    try {
        console.log('🚀 CREATE CONTACT REQUEST RECEIVED');
        console.log('📝 Request body:', req.body);
        console.log(
            '👤 Authenticated user:',
            req.authenticatedUser?.firstName,
            req.authenticatedUser?.email,
        );
        console.log('🔐 Privilege:', req.privilege?.name);

        const { firstName, lastName, phone, email, gender, dob, labels, deviceId } = req.body;

        if (!firstName || !phone || !deviceId) {
            console.log('❌ Missing required fields:', {
                firstName: !!firstName,
                phone: !!phone,
                deviceId: !!deviceId,
            });
            return res.status(400).json({ message: 'firstName, phone, and deviceId are required' });
        }

        const pkId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;
        console.log('🆔 User PKId:', pkId, 'Privilege PKId:', privilegeId);

        // Check if contact already exists
        console.log('🔍 Checking for existing contact with phone:', phone, 'deviceId:', deviceId);

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
            console.log(
                '❌ Contact already exists:',
                existingContact.firstName,
                existingContact.phone,
            );
            return res.status(400).json({
                message: 'Contact with this phone number already exists in your device',
            });
        }

        console.log('✅ No existing contact found, proceeding with creation...');

        // Validate device exists and get session before transaction
        console.log('🔍 Finding device with ID:', deviceId);
        const existingDevice = await prisma.device.findUnique({
            where: {
                id: deviceId,
            },
            include: { sessions: { select: { sessionId: true } } },
        });

        if (!existingDevice) {
            console.log('❌ Device not found with ID:', deviceId);
            return res.status(404).json({ message: 'Device not found' });
        }

        console.log(
            '✅ Device found:',
            existingDevice.name,
            'Sessions:',
            existingDevice.sessions.length,
        );

        const sessionId = existingDevice.sessions[0]?.sessionId;

        const created = await prisma.$transaction(async (transaction) => {
            console.log('📝 Creating contact with data:', {
                firstName,
                lastName,
                phone,
                email,
                gender,
                dob,
            });

            // step 1: create contact
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
            console.log('✅ Contact created with ID:', createdContact.id);

            // step 2: create labels (only if provided by user). Do NOT auto-append device label
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
                console.log('✅ Labels created and linked');
            }

            // step 3: update message history
            if (sessionId) {
                console.log('🔄 Updating message history...');
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

            // step 4: create contact-device relationship
            console.log('🔗 Creating contact-device relationship...');
            await transaction.contactDevice.create({
                data: {
                    contactId: createdContact.pkId,
                    deviceId: existingDevice.pkId,
                },
            });

            console.log('✅ Contact creation completed successfully');

            return { contactId: createdContact.id, contactName: createdContact.firstName };
        });

        // Send response after transaction completes successfully
        res.status(200).json({
            message: 'Contact created successfully',
            contactId: created.contactId,
            contactName: created.contactName,
        });
    } catch (error: unknown) {
        console.error('❌ ERROR in createContact:', error);
        logger.error(error);

        // Handle specific database errors
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
    // Hapus dependency subscription
    // const subscription = req.subscription;
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
            const groupName = req.body.groupName;

            await workbook.xlsx.load(buffer);
            const worksheet = workbook.getWorksheet(1);
            if (!worksheet) {
                return res.status(400).json({ message: 'No worksheet found' });
            }

            const contacts: any[] = [];

            worksheet.eachRow((row, rowNumber) => {
                const firstName = row.getCell(1).value;
                const lastName = row.getCell(2).value;
                const phone = row.getCell(3).value?.toString();
                const email = row.getCell(4).value;
                const gender = row.getCell(5).value;
                const dob = row.getCell(6).value?.toString();
                const labels = row.getCell(7).value;
                if (!firstName || !phone) {
                    return res
                        .status(400)
                        .json({ message: 'firstName and phone values are required.' });
                }
                if (rowNumber !== 1) {
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
                }
            });

            // Hapus pengecekan quota - biarkan unlimited
            // if (subscription.contactUsed + contacts.length > subscription.contactMax) {
            //     return res.status(404).json({
            //         message: `Need more ${
            //             subscription.contactUsed + contacts.length - subscription.contactMax
            //         } contact quota to perform this action`,
            //     });
            // }

            const pkId = req.authenticatedUser.pkId;
            let group: {
                pkId: any;
                id?: string;
                name?: string;
                type?: string;
                userId?: number;
                createdAt?: Date;
                updatedAt?: Date;
            };
            for (let index = 0; index < contacts.length; index++) {
                const email = contacts[index].email?.text ?? contacts[index].email;
                try {
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
                            'Contact with this email or phone number already exists in your contact',
                        );
                    }
                    await prisma.$transaction(async (transaction) => {
                        // step 1: create contact
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

                        // step 2: create group
                        if (index === 0) {
                            group = await transaction.group.create({
                                data: {
                                    name: `IMPORT_${groupName}`,
                                    type: 'import',
                                    user: { connect: { pkId } },
                                },
                            });
                        }
                        if (group) {
                            await transaction.contactGroup.create({
                                data: {
                                    groupId: group.pkId,
                                    contactId: createdContact.pkId,
                                },
                            });
                        }

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

                        // step 3: create labels (only those provided in file, do NOT auto append device label)
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

                        // step 4: create contacts to devices relationship
                        await transaction.contactDevice.create({
                            data: {
                                contactId: createdContact.pkId,
                                deviceId: existingDevice.pkId,
                            },
                        });

                        // step 5: replace contact info in outgoing & incoming message
                        await transaction.outgoingMessage.updateMany({
                            where: {
                                to: contacts[index].phone + '@s.whatsapp.net',
                                sessionId: existingDevice.sessions[0].sessionId,
                            },
                            data: {
                                contactId: createdContact.pkId,
                            },
                        });

                        await transaction.incomingMessage.updateMany({
                            where: {
                                from: contacts[index].phone + '@s.whatsapp.net',
                                sessionId: existingDevice.sessions[0].sessionId,
                            },
                            data: {
                                contactId: createdContact.pkId,
                            },
                        });

                        // Hapus step 6: decrease contact quota
                        // await useContact(transaction, subscription, subscription.contactUsed + 1);
                        // subscription.contactUsed = subscription.contactUsed + 1;

                        results.push({ index, createdContact });
                    });
                } catch (error: unknown) {
                    const message =
                        error instanceof Error
                            ? error.message
                            : 'An error occurred during import contacts';
                    errors.push({ index, error: message });
                }
            }
            res.status(200).json({ results, errors });
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getContacts: RequestHandler = async (req, res) => {
    const pkId = req.authenticatedUser.pkId;
    const privilegeId = req.privilege.pkId;
    const deviceId = req.query.deviceId as string;
    const q = (req.query.q as string) || '';
    const page = Math.max(1, Number(req.query.page) || 1);
    const pageSize = Math.max(1, Math.min(200, Number(req.query.pageSize) || 25));
    const sortByRaw = String(req.query.sortBy || 'createdAt');
    const sortDirRaw = String(req.query.sortDir || 'desc').toLowerCase();
    const wantsMeta =
        typeof req.query.page !== 'undefined' ||
        typeof req.query.pageSize !== 'undefined' ||
        String(req.query.withMeta || '').toLowerCase() === 'true';

    const sortBy = ['firstName', 'lastName', 'phone', 'createdAt'].includes(sortByRaw)
        ? (sortByRaw as 'firstName' | 'lastName' | 'phone' | 'createdAt')
        : 'createdAt';
    const sortDir = sortDirRaw === 'asc' ? 'asc' : 'desc';

    const searchWhere = q
        ? {
              OR: [
                  { firstName: { contains: q, mode: 'insensitive' as const } },
                  { lastName: { contains: q, mode: 'insensitive' as const } },
                  { phone: { contains: q } },
                  {
                      ContactLabel: {
                          some: { label: { name: { contains: q, mode: 'insensitive' as const } } },
                      },
                  },
              ],
          }
        : {};

    try {
        const baseWhereSuper = {
            contactDevices: { some: { device: { id: deviceId ?? undefined } } },
            ...(q ? searchWhere : {}),
        } as const;
        const baseWhereCS = {
            contactDevices: {
                some: {
                    device: {
                        id: deviceId ?? undefined,
                        OR: [{ CustomerService: { is: { userId: pkId } } }, { userId: pkId }],
                    },
                },
            },
            ...(q ? searchWhere : {}),
        } as const;
        const baseWhereUser = {
            contactDevices: { some: { device: { id: deviceId ?? undefined, userId: pkId } } },
            ...(q ? searchWhere : {}),
        } as const;

        const where =
            privilegeId == Number(process.env.SUPER_ADMIN_ID)
                ? (baseWhereSuper as any)
                : privilegeId == Number(process.env.CS_ID)
                ? (baseWhereCS as any)
                : (baseWhereUser as any);

        const skip = (page - 1) * pageSize;
        const [rows, total] = await Promise.all([
            prisma.contact.findMany({
                where,
                include: { ContactLabel: { select: { label: { select: { name: true } } } } },
                orderBy: { [sortBy]: sortDir } as any,
                skip: wantsMeta ? skip : 0,
                take: wantsMeta ? pageSize : undefined,
            }),
            prisma.contact.count({ where }),
        ]);

        if (!wantsMeta) {
            // Legacy response: plain array
            return res.status(200).json(rows);
        }

        const totalPages = Math.ceil(total / pageSize) || 1;
        const hasMore = page * pageSize < total;

        return res.status(200).json({
            data: rows,
            metadata: { totalContacts: total, currentPage: page, totalPages, hasMore },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getContactLabels: RequestHandler = async (req, res) => {
    const pkId = req.authenticatedUser.pkId;
    const privilegeId = req.privilege.pkId;
    const deviceId = (req.query.deviceId as string) || undefined;

    try {
        // Build where clause based on privilege and optional deviceId
        let whereClause: any;
        const isSuperAdmin = privilegeId == Number(process.env.SUPER_ADMIN_ID);

        if (isSuperAdmin) {
            whereClause = deviceId
                ? {
                      ContactLabel: {
                          some: {
                              contact: { contactDevices: { some: { device: { id: deviceId } } } },
                          },
                      },
                  }
                : { ContactLabel: { some: { contact: { contactDevices: { some: {} } } } } };
        } else {
            // For regular users and CS users: labels from devices they own OR they are assigned to (via CustomerService.userId)
            whereClause = {
                ContactLabel: {
                    some: {
                        contact: {
                            contactDevices: {
                                some: {
                                    device: {
                                        id: deviceId ?? undefined,
                                        OR: [
                                            { userId: pkId },
                                            { CustomerService: { is: { userId: pkId } } },
                                        ],
                                    },
                                },
                            },
                        },
                    },
                },
            };
        }

        const labels = await prisma.label.findMany({ where: whereClause, select: { name: true } });
        // Filter out internal device_* labels and deduplicate
        const unique = Array.from(
            new Set(
                labels
                    .map((l) => l.name)
                    .filter((name) => typeof name === 'string' && !name.startsWith('device_')),
            ),
        );

        res.status(200).json(unique);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: display history, and media
export const getContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;
        if (!isUUID(contactId)) {
            return res.status(400).json({ message: 'Invalid contactId' });
        }

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
                            select: { name: true, id: true },
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
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateContact: RequestHandler = async (req, res) => {
    try {
        const contactId = req.params.contactId;
        const { firstName, lastName, phone, email, gender, dob, labels, deviceId } = req.body;

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

            // update contact core fields
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

            // update device link if provided (do NOT enforce device_* label automatically)
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

            // update labels associations
            // If labels is provided (even empty array), set associations to match exactly.
            if (Array.isArray(labels)) {
                // Remove all current associations
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

export const deleteContacts: RequestHandler = async (req, res) => {
    try {
        const contactIds = (req.body.contactIds as string[]) || [];
        if (!Array.isArray(contactIds) || contactIds.length === 0) {
            return res.status(400).json({ message: 'contactIds is required' });
        }

        await prisma.$transaction(async (tx) => {
            // Delete contacts by UUID ids
            await tx.contact.deleteMany({ where: { id: { in: contactIds } } });
            // Cleanup orphan labels (no longer referenced by any contact)
            await tx.label.deleteMany({ where: { ContactLabel: { none: {} } } });
        });

        res.status(200).json({ message: 'Contact(s) deleted successfully' });
    } catch (error) {
        logger.error(error);
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

        // wait for all the Promises to settle (either resolve or reject)
        await Promise.all(groupPromises);

        res.status(200).json({ message: 'Contact added to group(s) successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// back here: replace 0 to country code format (such as: +62)
// back here: handle invalid google credentials
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

            // set up upload
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

            // upload
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
                    // emailAddresses: [
                    //     {
                    //         value: 'johndoe@example.com',
                    //         type: 'home',
                    //     },
                    // ],
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

            // set up download
            for (const contact of connections) {
                const phones = contact.phoneNumbers || [];
                const phone =
                    phones && phones.length > 0
                        ? phones[0].canonicalForm?.replace(/\+/g, '')
                        : contact.names && contact.names.length > 0
                        ? contact.names[0].displayNameLastFirst.split(',')[0]
                        : '';
                // const nameParts = contact.names[0].displayNameLastFirst.split(',');
                // const lastName = nameParts.length > 1 ? nameParts[0].trim() : null;
                // const firstName = lastName ? nameParts[1].trim() : nameParts[0].trim();
                // const email = contact.emailAddresses && contact.emailAddresses.length > 0 ? contact.emailAddresses[0].value : null;
                const firstName = contact.names ? contact.names[0].displayName : phone;

                const data = {
                    firstName,
                    // lastName,
                    phone,
                    // email,
                    // gender,
                    // dob,
                    // labels,
                };
                googleContactsData.push(data);
            }
            // download
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
                        // step 1: create contact
                        const createdContact = await transaction.contact.create({
                            data: {
                                firstName: googleContactsData[index].firstName,
                                // lastName: data.lastName,
                                phone: googleContactsData[index].phone,
                                // email,
                                // gender: data.gender,
                                // dob: data.dob ? new Date(data.dob) : null,
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

                        // step 2: create labels
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

                        // step 3: create contacts to devices relationship
                        await transaction.contactDevice.create({
                            data: {
                                contactId: createdContact.pkId,
                                deviceId: existingDevice.pkId,
                            },
                        });

                        // step 4: replace contact info in outgoing & incoming message
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

                        // step 5: decrease contact quota
                        // await useContact(transaction, subscription, subscription.contactUsed + 1);
                        // subscription.contactUsed = subscription.contactUsed + 1;
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

export const exportContacts: RequestHandler = async (req, res) => {
    try {
        const pkId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;
        const deviceId = req.query.deviceId as string;
        let contacts;
        if (privilegeId == Number(process.env.SUPER_ADMIN_ID)) {
            contacts = await prisma.contact.findMany({
                where: {
                    contactDevices: {
                        some: {
                            device: {
                                id: deviceId ?? undefined,
                            },
                        },
                    },
                },
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
        } else if (privilegeId == Number(process.env.CS_ID)) {
            contacts = await prisma.contact.findMany({
                where: {
                    contactDevices: {
                        some: {
                            device: {
                                id: deviceId ?? undefined,
                                OR: [
                                    { CustomerService: { is: { userId: pkId } } }, // Assigned as CS (by userId)
                                    { userId: pkId }, // Owned by user
                                ],
                            },
                        },
                    },
                },
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
        } else {
            contacts = await prisma.contact.findMany({
                where: {
                    contactDevices: {
                        some: {
                            device: {
                                id: deviceId ?? undefined,
                                userId: pkId,
                            },
                        },
                    },
                },
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
        }

        let workbook = new ExcelJS.Workbook();
        let worksheet = workbook.addWorksheet('Contacts');
        worksheet.columns = [
            { header: 'First Name', key: 'firstName', width: 20 },
            { header: 'Last Name', key: 'lastName', width: 20 },
            { header: 'Phone', key: 'phone', width: 20 },
            { header: 'Email', key: 'email', width: 20 },
            { header: 'Gender', key: 'gender', width: 20 },
            { header: 'Date of Birth', key: 'dob', width: 20 },
            { header: 'Labels', key: 'labels', width: 20 },
        ];

        contacts.forEach((contact) => {
            worksheet.addRow({
                firstName: contact.firstName,
                lastName: contact.lastName,
                phone: Number(contact.phone),
                email: contact.email,
                gender: contact.gender,
                dob: contact.dob,
                labels: contact.ContactLabel.map((label) => label.label.name).join(','),
            });
        });

        const date = new Date().toISOString().split('T')[0];

        const filename = `Contacts_${date}.xlsx`;

        res.setHeader(
            'Content-Type',
            'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        );
        res.setHeader('Content-Disposition', `attachment; filename=${filename}`);

        workbook.xlsx.write(res);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
