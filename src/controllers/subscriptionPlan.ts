import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import { isUUID } from '../utils/uuidChecker';

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

        res.status(201).json({
            message: 'Subscription plan created successfully',
            data: subscriptionPlan,
        });
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
    try {
        const id = req.params.id;

        if (!isUUID(id)) {
            return res.status(400).json({ message: 'Invalid subscriptionPlanId' });
        }

        const subscriptionPlan = await prisma.subscriptionPlan.findUnique({
            where: { id },
        });

        if (subscriptionPlan) {
            res.status(200).json(subscriptionPlan);
        } else {
            res.status(404).json({ error: 'Subscription plan not found' });
        }
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateSubscriptionPlan: RequestHandler = async (req, res) => {
    try {
        const id = req.params.id;

        if (!isUUID(id)) {
            return res.status(400).json({ message: 'Invalid subscriptionPlanId' });
        }

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
            where: { id },
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

        res.status(201).json({
            message: 'Subscription plan updated successfully',
            data: updatedSubscriptionPlan,
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteSubscriptionPlan: RequestHandler = async (req, res) => {
    try {
        const id = req.params.id;

        if (!isUUID(id)) {
            return res.status(400).json({ message: 'Invalid subscriptionPlanId' });
        }
        await prisma.subscriptionPlan.delete({
            where: { id },
        });

        res.status(200).json({ message: 'Subscription plan deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
