import { RequestHandler } from 'express';
import prisma from '../utils/db';

export const getGroups: RequestHandler = async (req, res) => {
    try {
        const contacts = await prisma.group.findMany();
        res.status(200).json(contacts);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};
