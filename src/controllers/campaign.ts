import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getInstance, getJid } from '../whatsapp';
import logger from '../config/logger';
import schedule from 'node-schedule';
import { delay as delayMs } from '../utils/delay';

// back here: registered success msg, fail, unsubscribe msg
// back here: get recipients from contact labels or group
export const createCampaign: RequestHandler = async (req, res) => {
    try {
        const {
            name,
            syntaxRegistration,
            registrationMessage,
            messageRegistered,
            recipients,
            deviceId,
            delay = 5000,
        } = req.body;

        const userId = req.authenticatedUser.pkId;

        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            include: { sessions: { select: { sessionId: true } } },
        });

        if (!device) {
            return res.status(401).json({ message: 'Device not found' });
        } else if (!device.sessions[0]) {
            return res.status(400).json({ message: 'Session not found' });
        } else {
            const session = getInstance(device.sessions[0].sessionId)!;
            const campaign = await prisma.$transaction(
                async (transaction) => {
                    const group = await transaction.group.create({
                        data: {
                            name,
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
                            syntaxRegistration,
                            registrationMessage,
                            messageRegistered,
                            groupId: group.pkId,
                            deviceId: device.pkId,
                        },
                    });
                    return campaign;
                },
                {
                    maxWait: 5000, // default: 2000
                    timeout: 15000, // default: 5000
                },
            );
            for (const recipient of campaign.recipients) {
                const jid = getJid(recipient);
                // await verifyJid(session, jid, type);
                await delayMs(delay);
                await session.sendMessage(jid, {
                    text: `${campaign.registrationMessage} ${campaign.syntaxRegistration}`,
                });
            }
            await prisma.campaign.update({
                where: { id: campaign.id },
                data: {
                    isSent: true,
                    updatedAt: new Date(),
                },
            });
            res.status(201).json({ mmessage: 'Campaign created successfully' });
        }
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createCampaignMessage: RequestHandler = async (req, res) => {
    try {
        const { message, schedule, delay } = req.body;
        const campaignId = req.params.campaignId;

        const campaign = await prisma.campaign.findUnique({
            where: { id: campaignId },
        });

        if (!campaign) {
            res.status(404).json({ message: 'Campaign not found' });
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

// back here: prevent regis twice
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendCampaign(sessionId: any, data: any) {
    try {
        const session = getInstance(sessionId)!;
        const recipient = data.key.remoteJid;
        const jid = getJid(recipient);
        const name = data.pushName;
        const messageText =
            data.message?.conversation ||
            data.message?.extendedTextMessage?.text ||
            data.message?.imageMessage?.caption ||
            '';
        const parts = messageText.split('#');
        const prefix = parts[0] + '#' + parts[1] + '#';
        const matchingCampaign = await prisma.campaign.findFirst({
            where: {
                syntaxRegistration: {
                    mode: 'insensitive',
                    contains: prefix,
                },
                device: { sessions: { some: { sessionId } } },
            },
            include: { group: { select: { pkId: true } } },
        });
        if (matchingCampaign) {
            const replyText = matchingCampaign.messageRegistered;
            // back here: send non-text message
            session.sendMessage(jid, { text: replyText.replace(/\{\{\$firstName\}\}/, name) });
            logger.warn(matchingCampaign, 'campaign response sent successfully');

            await prisma.$transaction(async (transaction) => {
                const contact = await transaction.contact.create({
                    data: {
                        firstName: name,
                        phone: recipient.split('@')[0],
                        email: '',
                        gender: '',
                        dob: new Date(),
                    },
                });
                await transaction.contactGroup.create({
                    data: {
                        contactId: contact.pkId,
                        groupId: matchingCampaign.group.pkId,
                    },
                });
            });
        }
    } catch (error) {
        logger.error(error);
        throw error;
    }
}

// back here: get subscriberCount
export const getAllCampaigns: RequestHandler = async (req, res) => {
    try {
        const deviceId = req.query.deviceId as string;
        const userId = req.authenticatedUser.pkId;
        const privilegeId = req.privilege.pkId;

        const campaigns = await prisma.campaign.findMany({
            where: {
                device: {
                    userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
                    id: deviceId,
                },
            },
            include: { device: true },
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
        });

        res.status(200).json(campaignMessages);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// to do: campaign detail
// to do: campaign message detail
// back here: sent, received, read, replied filter
// to do: CRUD campaign message template
// to do: edit & delete campaigns

const processedRecipients: (string | number)[] = [];

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
                await session.sendMessage(jid, { text: campaignMessage.message });
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
        logger.debug('Campaign job is running...');
    } catch (error) {
        logger.error(error, 'Error processing scheduled campaign messages');
    }
});
