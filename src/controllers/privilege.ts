import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const getPrivileges: RequestHandler = async (req, res) => {
    try {
        const privileges = await prisma.privilege.findMany();
        res.status(200).json(privileges);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
