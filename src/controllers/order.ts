import { RequestHandler } from 'express';
import logger from '../config/logger';
import prisma from '../utils/db';

export const createOrderMessages: RequestHandler = async (req, res) => {
    try {
        const { orderTemplate, welcomeMessage, processMessage, completeMessage } = req.body;
        const csId = req.authenticatedUser.pkId;

        const existingOrderMessage = await prisma.orderMessage.findUnique({
            where: { csId },
        });

        if (existingOrderMessage) {
            return res.status(400).json({ message: 'Order message already exists' });
        }
        await prisma.orderMessage.create({
            data: {
                csId,
                orderTemplate,
                welcomeMessage,
                processMessage,
                completeMessage,
            },
        });

        res.status(201).json({ message: 'Order message created successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getOrderMessages: RequestHandler = async (req, res) => {
    try {
        const csId = req.authenticatedUser.pkId;

        const orderMessage = await prisma.orderMessage.findUnique({
            where: {
                csId,
            },
        });
        res.status(200).json(orderMessage);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
