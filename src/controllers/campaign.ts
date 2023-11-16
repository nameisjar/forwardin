import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getInstance, getJid } from '../whatsapp';
import logger from '../config/logger';
import schedule from 'node-schedule';
import { delay as delayMs } from '../utils/delay';
import { replaceVariables } from '../utils/variableHelper';
import { generateSlug } from '../utils/slug';
import { getRandomColor } from '../utils/profilePic';

export const createCampaign: RequestHandler = async (req, res) => {
    try {
        const {
            name,
            schedule,
            registrationSyntax,
            unregistrationSyntax,
            registrationMessage,
            messageRegistered,
            messageFailed,
            messageUnregistered,
            recipients,
            deviceId,
            delay = 5000,
        } = req.body;

        if (
            recipients.includes('all') &&
            recipients.some((recipient: { startsWith: (arg0: string) => string }) =>
                recipient.startsWith('label'),
            )
        ) {
            return res.status(400).json({
                message:
                    "Recipients can't contain both all contacts and contact labels at the same input",
            });
        }

        const existingCampaign = await prisma.campaign.findFirst({
            where: {
                OR: [
                    { registrationSyntax: { mode: 'insensitive', equals: registrationSyntax } },
                    { unregistrationSyntax: { mode: 'insensitive', equals: unregistrationSyntax } },
                ],
            },
        });

        logger.warn(existingCampaign);

        if (existingCampaign) {
            return res
                .status(400)
                .json({ message: 'Campaign registration or unregistration syntax already used' });
        }

        const userId = req.authenticatedUser.pkId;

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            include: { sessions: { select: { sessionId: true } } },
        });

        if (!device) {
            return res.status(401).json({ message: 'Device not found' });
        }
        if (!device.sessions[0]) {
            return res.status(400).json({ message: 'Session not found' });
        }
        await prisma.$transaction(
            async (transaction) => {
                const group = await transaction.group.create({
                    data: {
                        name: `CP_${name}`,
                        isCampaign: true,
                        user: { connect: { pkId: userId } },
                    },
                });

                const campaign = await transaction.campaign.create({
                    data: {
                        name,
                        recipients: {
                            set: recipients,
                        },
                        schedule,
                        registrationSyntax: registrationSyntax.toUpperCase(),
                        unregistrationSyntax: unregistrationSyntax.toUpperCase(),
                        registrationMessage,
                        messageRegistered,
                        messageFailed,
                        messageUnregistered,
                        delay,
                        groupId: group.pkId,
                        deviceId: device.pkId,
                    },
                    include: {
                        device: {
                            select: {
                                contactDevices: {
                                    select: { contact: { select: { phone: true } } },
                                },
                            },
                        },
                    },
                });
                return campaign;
            },
            {
                maxWait: 5000, // default: 2000
                timeout: 15000, // default: 5000
            },
        );

        res.status(201).json({ mmessage: 'Campaign created successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createCampaignMessage: RequestHandler = async (req, res) => {
    try {
        const { message, schedule, campaignId, delay } = req.body;

        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
        });

        if (!campaign) {
            res.status(404).json({ message: { message: 'Campaign not found' } });
        } else {
            await prisma.campaignMessage.create({
                data: {
                    message,
                    schedule,
                    delay,
                    campaignId: campaign.pkId,
                },
            });

            res.status(201).json({ message: 'Campaign message created successfully' });
        }
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendCampaignReply(sessionId: any, data: any) {
    try {
        const session = getInstance(sessionId)!;
        const recipient = data.key.remoteJid;
        const jid = getJid(recipient);
        const phoneNumber = recipient.split('@')[0];
        const name = data.pushName;
        const messageText =
            data.message?.conversation ||
            data.message?.extendedTextMessage?.text ||
            data.message?.imageMessage?.caption ||
            '';
        // const parts = messageText.split('#');
        // const prefix = parts[0] + '#' + parts[1];
        const matchingCampaign = await prisma.campaign.findFirst({
            where: {
                AND: [
                    {
                        OR: [
                            {
                                registrationSyntax: {
                                    mode: 'insensitive',
                                    equals: messageText,
                                },
                            },
                            {
                                unregistrationSyntax: {
                                    mode: 'insensitive',
                                    equals: messageText,
                                },
                            },
                        ],
                    },
                    {
                        OR: [
                            {
                                recipients: {
                                    has: '*',
                                },
                            },
                            {
                                recipients: {
                                    has: 'all',
                                },
                                device: {
                                    contactDevices: { some: { contact: { phone: phoneNumber } } },
                                },
                            },
                            {
                                recipients: {
                                    has: phoneNumber,
                                },
                            },
                        ],
                    },
                ],
                device: { sessions: { some: { sessionId } } },
            },
            include: {
                group: {
                    select: {
                        pkId: true,
                        contactGroups: { select: { contact: { select: { phone: true } } } },
                    },
                },
            },
        });

        const isMember = matchingCampaign?.group.contactGroups.some(
            (contactGroup) => contactGroup.contact.phone === phoneNumber,
        );

        const wantToUnreg =
            matchingCampaign?.unregistrationSyntax.toLowerCase() === messageText.toLowerCase();

        if (matchingCampaign) {
            let replyText: string;
            if (wantToUnreg && isMember) {
                replyText = matchingCampaign.messageUnregistered;
            } else if (!wantToUnreg && isMember) {
                replyText = matchingCampaign.messageFailed;
            } else if (wantToUnreg && !isMember) {
                replyText = `Hai, ${name}! Mohon registrasi terlebih dulu pakai format: ${matchingCampaign.registrationSyntax}`;
            } else {
                replyText = matchingCampaign.messageRegistered;
            }

            // back here: complete the provided variables
            const variables = {
                registrationSyntax: matchingCampaign.registrationSyntax,
                unregistrationSyntax: matchingCampaign.unregistrationSyntax,
                name: name,
                campaignName: matchingCampaign.name,
            };

            // back here: send non-text message
            session.readMessages([data.key]);
            session.sendMessage(
                jid,
                { text: replaceVariables(replyText, variables) },
                { quoted: data },
            );
            logger.warn(matchingCampaign, 'campaign response sent successfully');

            await prisma.$transaction(async (transaction) => {
                if (!isMember && !wantToUnreg) {
                    const contact = await transaction.contact.create({
                        data: {
                            firstName: name,
                            phone: phoneNumber,
                            gender: '',
                            dob: new Date(),
                            colorCode: getRandomColor(),
                        },
                    });
                    await transaction.contactGroup.create({
                        data: {
                            contactId: contact.pkId,
                            groupId: matchingCampaign.group.pkId,
                        },
                    });
                } else if (isMember && wantToUnreg) {
                    const contact = await transaction.contact.findFirst({
                        where: {
                            phone: phoneNumber,
                            contactGroups: {
                                some: {
                                    contact: { phone: phoneNumber },
                                    groupId: matchingCampaign.group.pkId,
                                },
                            },
                        },
                    });

                    if (contact) {
                        await transaction.contactGroup.delete({
                            where: {
                                contactId_groupId: {
                                    groupId: matchingCampaign.group.pkId,
                                    contactId: contact.pkId,
                                },
                            },
                        });
                    }
                }
            });
        }
    } catch (error) {
        logger.error(error);
        throw error;
    }
}

export const getAllCampaigns: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        const campaigns = await prisma.campaign.findMany({
            where: {
                device: {
                    userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
                    id: deviceId ?? undefined,
                    user: { pkId: userId },
                },
            },
            select: {
                id: true,
                name: true,
                status: true,
                recipients: true,
                registrationSyntax: true,
                device: { select: { name: true } },
                createdAt: true,
                updatedAt: true,
                group: { select: { _count: { select: { contactGroups: true } } } },
            },
        });

        res.status(200).json(campaigns);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAllCampaignMessagess: RequestHandler = async (req, res) => {
    try {
        const campaignId = req.params.campaignId;

        const campaignMessages = await prisma.campaignMessage.findMany({
            where: { Campaign: { id: campaignId } },
            include: {
                Campaign: {
                    select: {
                        group: {
                            select: {
                                contactGroups: { select: { contact: { select: { phone: true } } } },
                            },
                        },
                    },
                },
            },
        });

        const newCampaignMessages = [];
        for (const cpm of campaignMessages) {
            const sentCount = await prisma.outgoingMessage.count({
                where: { id: { contains: `CPM_${cpm.pkId}` }, status: 'server_ack' },
            });
            const receivedCount = await prisma.outgoingMessage.count({
                where: { id: { contains: `CPM_${cpm.pkId}` }, status: 'delivery_ack' },
            });
            const readCount = await prisma.outgoingMessage.count({
                where: { id: { contains: `CPM_${cpm.pkId}` }, status: 'read' },
            });

            // const recipients = await getRecipients(cpm);
            const recipients = cpm.Campaign.group.contactGroups;

            const uniqueRecipients = new Set();
            for (const recipient of recipients) {
                const incomingMessagesCount = await prisma.incomingMessage.count({
                    where: {
                        from: `${recipient.contact.phone}@s.whatsapp.net`,
                        updatedAt: {
                            gte: cpm.createdAt,
                        },
                    },
                });

                if (incomingMessagesCount > 0) {
                    uniqueRecipients.add(recipient);
                }
            }
            const uniqueRecipientsCount = uniqueRecipients.size;

            newCampaignMessages.push({
                ...cpm,
                sentCount: sentCount,
                receivedCount: receivedCount,
                readCount: readCount,
                repliesCount: uniqueRecipientsCount,
            });
        }

        res.status(200).json(campaignMessages);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// to do: campaign detail
export const getCampaign: RequestHandler = async (req, res) => {
    try {
        const campaignId = req.params.campaignId;

        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: {
                id: true,
                name: true,
                schedule: true,
                recipients: true,
                registrationMessage: true,
                unregistrationSyntax: true,
                messageRegistered: true,
                messageFailed: true,
                messageUnregistered: true,
            },
        });

        if (!campaign) {
            return res.status(404).json({ message: 'Campaign not found' });
        }

        res.status(200).json(campaign);
    } catch (error) {
        logger.error(error);
    }
};

export const getOutgoingCampaigns: RequestHandler = async (req, res) => {
    try {
        const campaignId = req.params.campaignId;
        const status = req.query.status as string;

        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
            select: { pkId: true },
        });

        if (!campaign) {
            return res.status(404).json('Campaign not found');
        }

        const outgoingCampaigns = await prisma.outgoingMessage.findMany({
            where: {
                id: { contains: `CP_${campaign.pkId}` },
                status,
            },
            include: {
                contact: {
                    select: {
                        firstName: true,
                        lastName: true,
                        phone: true,
                        colorCode: true,
                        ContactLabel: { select: { label: { select: { name: true } } } },
                    },
                },
            },
        });

        res.status(200).json({ outgoingCampaigns });
    } catch (error) {
        logger.error(error);
    }
};

export const getCampaignReplies: RequestHandler = async (req, res) => {
    try {
        const campaignId = req.params.campaignId;

        const campaign = await prisma.campaign.findUnique({
            select: { recipients: true, createdAt: true },
            where: { id: campaignId },
        });

        if (!campaign) {
            return res.status(404).json({ message: 'Campaign not found' });
        }

        const campaignReplies = [];

        for (const recipient of campaign.recipients) {
            const incomingMessages = await prisma.incomingMessage.findFirst({
                where: {
                    from: `${recipient}@s.whatsapp.net`,
                    updatedAt: {
                        gte: campaign.createdAt,
                    },
                },
                orderBy: {
                    updatedAt: 'desc',
                },
                include: {
                    contact: {
                        select: {
                            firstName: true,
                            lastName: true,
                            phone: true,
                            colorCode: true,
                            ContactLabel: { select: { label: { select: { name: true } } } },
                        },
                    },
                },
            });
            if (incomingMessages) {
                campaignReplies.push(incomingMessages);
            }
        }
        res.status(200).json({ campaignReplies });
    } catch (error) {
        logger.error(error);
    }
};

// to do: campaign message detail
// to do: CRUD campaign message template
// to do: edit & delete campaigns

// to do: handle scheduled campaign
// back here: send media
schedule.scheduleJob('*', async () => {
    try {
        const pendingcampaignMessages = await prisma.campaignMessage.findMany({
            where: {
                schedule: {
                    lte: new Date(),
                },
                isSent: false,
            },
            include: {
                Campaign: {
                    select: {
                        device: { select: { sessions: { select: { sessionId: true } } } },
                        group: {
                            select: {
                                contactGroups: { select: { contact: { select: { phone: true } } } },
                            },
                        },
                    },
                },
            },
        });

        for (const campaignMessage of pendingcampaignMessages) {
            const processedRecipients: (string | number)[] = [];

            const session = getInstance(campaignMessage.Campaign.device.sessions[0].sessionId)!;
            for (let i = 0; i < campaignMessage.Campaign.group.contactGroups.length; i++) {
                const recipient = campaignMessage.Campaign.group.contactGroups[i];
                const isLastRecipient =
                    i === campaignMessage.Campaign.group.contactGroups.length - 1;

                if (processedRecipients.includes(recipient.contact.phone)) {
                    logger.info(
                        {
                            message: 'Campaign recipient has already been processed',
                            recipient: recipient.contact.phone,
                        },
                        'skip campaign',
                    );
                    continue;
                }

                const jid = getJid(recipient.contact.phone);

                await session.sendMessage(
                    jid,
                    { text: campaignMessage.message },
                    { messageId: `CPM_${campaignMessage.pkId}_${Date.now()}` },
                );

                processedRecipients.push(recipient.contact.phone);
                logger.info(
                    {
                        message: 'Campaign has just been processed',
                        recipient: recipient.contact.phone,
                    },
                    'campaign sent',
                );

                await delayMs(isLastRecipient ? 0 : campaignMessage.delay);
            }

            await prisma.campaignMessage.update({
                where: { id: campaignMessage.id },
                data: {
                    isSent: true,
                    updatedAt: new Date(),
                },
            });
        }
        logger.debug('Campaign message job is running...');
    } catch (error) {
        logger.error(error, 'Error processing scheduled campaign messages');
    }
});

// back here: send media
schedule.scheduleJob('*', async () => {
    try {
        const pendingCampaigns = await prisma.campaign.findMany({
            where: {
                schedule: {
                    lte: new Date(),
                },
                isSent: false,
            },
            include: {
                device: {
                    select: {
                        sessions: { select: { sessionId: true } },
                        contactDevices: {
                            select: { contact: { select: { firstName: true, phone: true } } },
                        },
                    },
                },
            },
        });

        // back here: processedRecipients
        for (const campaign of pendingCampaigns) {
            const processedRecipients: (string | number)[] = [];
            const session = getInstance(campaign.device.sessions[0].sessionId)!;
            const recipients: string[] = [];
            for (const recipient of campaign.recipients) {
                // all == all contacts
                // label == contact labels
                // can't use "all" and "label" at the same time
                if (recipient.includes('all')) {
                    const contacts = await prisma.contact.findMany({
                        where: { contactDevices: { some: { deviceId: campaign.deviceId } } },
                    });
                    contacts.map((c) => {
                        if (!recipients.includes(c.phone)) {
                            recipients.push(c.phone);
                        }
                    });
                } else if (recipient.includes('label')) {
                    const contactLabel = recipient.split('_')[1];

                    const contacts = await prisma.contact.findMany({
                        where: {
                            contactDevices: { some: { deviceId: campaign.deviceId } },
                            ContactLabel: { some: { label: { slug: generateSlug(contactLabel) } } },
                        },
                    });

                    contacts.map((c) => {
                        if (!recipients.includes(c.phone)) {
                            recipients.push(c.phone);
                        }
                    });
                } else if (recipient.includes('group')) {
                    const groupName = recipient.split('_')[1];
                    const group = await prisma.group.findFirst({
                        where: {
                            contactGroups: {
                                some: {
                                    contact: {
                                        contactDevices: { some: { deviceId: campaign.deviceId } },
                                    },
                                },
                            },
                            name: groupName,
                        },
                        include: {
                            contactGroups: { select: { contact: { select: { phone: true } } } },
                        },
                    });
                    group?.contactGroups.map((c) => {
                        if (!recipients.includes(c.contact.phone)) {
                            recipients.push(c.contact.phone);
                        }
                    });
                } else {
                    recipients.push(recipient);
                }
            }

            // const recipients = campaign.recipients.includes('all')
            //     ? campaign.device.contactDevices.map((c) => c.contact.phone)
            //     : campaign.recipients;

            for (let i = 0; i < recipients.length; i++) {
                const recipient = recipients[i];
                const isLastRecipient = i === recipients.length - 1;

                if (processedRecipients.includes(recipient)) {
                    logger.info(
                        { message: 'Campaign recipient has already been processed', recipient },
                        'skip campaign',
                    );
                    continue;
                }

                const jid = getJid(recipient);
                // back here: complete the provided variables
                const variables = {
                    registrationSyntax: campaign.registrationSyntax,
                    unregistrationSyntax: campaign.unregistrationSyntax,
                    campaignName: campaign.name,
                    firstName: campaign.device.contactDevices[0].contact.firstName,
                };

                await session.sendMessage(
                    jid,
                    { text: replaceVariables(campaign.registrationMessage, variables) },
                    { messageId: `CP_${campaign.pkId}_${Date.now()}` },
                );

                processedRecipients.push(recipient);
                logger.info(
                    { message: 'Campaign has just been processed', recipient },
                    'campaign sent',
                );

                await delayMs(isLastRecipient ? 0 : campaign.delay);
            }
            await prisma.campaign.update({
                where: { id: campaign.id },
                data: {
                    isSent: true,
                    updatedAt: new Date(),
                },
            });
        }
        logger.debug('Campaign job is running...');
    } catch (error) {
        logger.error(error, 'Error processing scheduled campaigns');
    }
});
