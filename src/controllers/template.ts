import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const createTemplate: RequestHandler = async (req, res) => {
    try {
        const { name, message, userId } = req.body;

        const user = await prisma.user.findUnique({
            where: { id: userId },
        });

        if (!user) {
            return res.status(404).json({ message: 'User not found' });
        }

        const template = await prisma.template.create({
            data: {
                name,
                message,
                userId: user.pkId,
            },
        });
        res.status(201).json({ message: 'Template created successfully', template });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getTemplates: RequestHandler = async (req, res) => {
    const userId = req.authenticatedUser.pkId;
    const privilegeId = req.privilege.pkId;

    try {
        const templates = await prisma.template.findMany({
            where: {
                userId: privilegeId !== Number(process.env.SUPER_ADMIN_ID) ? userId : undefined,
            },
        });
        res.status(200).json(templates);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const deleteTemplates: RequestHandler = async (req, res) => {
    const templateIds = req.body.templateIds;

    try {
        const templatePromises = templateIds.map(async (templateId: string) => {
            await prisma.template.delete({
                where: { id: templateId },
            });
        });

        // wait for all the Promises to settle (either resolve or reject)
        await Promise.all(templatePromises);

        res.status(200).json({ message: 'Template(s) deleted successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
