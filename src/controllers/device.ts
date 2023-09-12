import { Request, Response } from 'express';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export const getAllDevices = async (req: Request, res: Response) => {
    try {
        const devices = await prisma.device.findMany();

        res.status(200).json(devices);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
