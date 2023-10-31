import { RequestHandler } from 'express';
import prisma from '../utils/db';

export const createCampaign: RequestHandler = async (req, res) => {
    try {
        const {
            name,
            syntaxRegistration,
            registrationMessage,
            messageRegistered,
            phone,
            campaignMessageId,
            groupId,
            deviceId,
        } = req.body;

        const campaign = await prisma.campaign.create({
            data: {
                name,
                syntaxRegistration,
                registrationMessage,
                messageRegistered,
                phone,
                campaignMessageId,
                groupId,
                deviceId,
            },
        });

        res.status(201).json(campaign);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};

export const createCampaignMessage: RequestHandler = async (req, res) => {
    try {
        const { day, message, sechedule, delay } = req.body;

        const campaign = await prisma.campaignMessage.create({
            data: {
                day,
                message,
                sechedule,
                delay,
            },
        });

        res.status(201).json(campaign);
    } catch (error) {
        console.error(error);
        res.status(500).json({ error: 'Internal server error' });
    }
};
