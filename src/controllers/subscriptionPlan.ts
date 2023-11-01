import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const createSubscriptionPlan: RequestHandler = async (req, res) => {
    try {
        const {
            name,
            monthlyPrice,
            yearlyPrice,
            autoReplyQuota,
            broadcastQuota,
            contactQuota,
            deviceQuota,
            isIntegration,
            isGoogleContactSync,
            isWhatsappContactSync,
            isAvailable,
        } = req.body;

        const subscriptionPlan = await prisma.subscriptionPlan.create({
            data: {
                name,
                monthlyPrice,
                yearlyPrice,
                autoReplyQuota,
                broadcastQuota,
                contactQuota,
                deviceQuota,
                isIntegration,
                isGoogleContactSync,
                isWhatsappContactSync,
                isAvailable,
            },
        });

        res.status(201).json(subscriptionPlan);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAllSubscriptionPlans: RequestHandler = async (req, res) => {
    try {
        const subscriptionPlans = await prisma.subscriptionPlan.findMany();
        res.status(200).json(subscriptionPlans);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getSubscriptionPlanById: RequestHandler = async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const subscriptionPlan = await prisma.subscriptionPlan.findUnique({
            where: { pkId: id },
        });

        if (subscriptionPlan) {
            res.json(subscriptionPlan);
        } else {
            res.status(404).json({ error: 'Subscription plan not found' });
        }
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateSubscriptionPlan: RequestHandler = async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        const {
            name,
            monthlyPrice,
            yearlyPrice,
            autoReplyQuota,
            broadcastQuota,
            contactQuota,
            deviceQuota,
            isIntegration,
            isGoogleContactSync,
            isWhatsappContactSync,
            isAvailable,
        } = req.body;

        const updatedSubscriptionPlan = await prisma.subscriptionPlan.update({
            where: { pkId: id },
            data: {
                name,
                monthlyPrice,
                yearlyPrice,
                autoReplyQuota,
                broadcastQuota,
                contactQuota,
                deviceQuota,
                isIntegration,
                isGoogleContactSync,
                isWhatsappContactSync,
                isAvailable,
                updatedAt: new Date(),
            },
        });

        res.json(updatedSubscriptionPlan);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteSubscriptionPlan: RequestHandler = async (req, res) => {
    const id = parseInt(req.params.id);

    try {
        await prisma.subscriptionPlan.delete({
            where: { pkId: id },
        });

        res.status(204).end();
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
