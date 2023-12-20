import { RequestHandler } from 'express';
import logger from '../config/logger';
import prisma from '../utils/db';
import { isUUID } from '../utils/uuidChecker';

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

export const updateOrderMessage: RequestHandler = async (req, res) => {
    try {
        const { orderTemplate, welcomeMessage, processMessage, completeMessage } = req.body;
        const csId = req.authenticatedUser.pkId;
        const orderMessageId = req.params.orderMessageId;

        const existingOrderMessage = await prisma.orderMessage.findUnique({
            where: { id: orderMessageId },
        });

        if (!existingOrderMessage) {
            return res.status(400).json({ message: 'Order message not found' });
        }
        await prisma.orderMessage.update({
            where: { id: orderMessageId },
            data: {
                csId,
                orderTemplate,
                welcomeMessage,
                processMessage,
                completeMessage,
            },
        });

        res.status(201).json({ message: 'Order message updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getOrderMessage: RequestHandler = async (req, res) => {
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

export const createOrder: RequestHandler = async (req, res) => {
    try {
        const { name, phone, orderData } = req.body;
        const csId = req.authenticatedUser.pkId;

        await prisma.order.create({
            data: {
                csId,
                name,
                phone,
                orderData,
            },
        });

        res.status(201).json({ message: 'Order created successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getOrders: RequestHandler = async (req, res) => {
    try {
        const csId = req.authenticatedUser.pkId;

        const orders = await prisma.order.findMany({
            where: {
                csId,
            },
            orderBy: {
                updatedAt: 'desc',
            },
        });
        res.status(200).json(orders);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateOrderStatus: RequestHandler = async (req, res) => {
    try {
        const status = req.body.status;
        const orderId = req.params.orderId;

        if (!isUUID(orderId)) {
            return res.status(400).json({ message: 'Invalid orderId' });
        }

        const csId = req.authenticatedUser.pkId;

        await prisma.order.update({
            where: { csId, id: orderId },
            data: {
                status,
                updatedAt: new Date(),
            },
        });

        res.status(201).json({ message: 'Order status updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
