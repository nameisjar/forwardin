import { RequestHandler } from 'express';
import { generateApiKey } from '../utils/apiKeyGenerator';
import prisma from '../utils/db';

export const getAllDevices: RequestHandler = async (req, res) => {
    try {
        const devices = await prisma.device.findMany();

        res.status(200).json(devices);
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createDevice: RequestHandler = async (req, res) => {
    try {
        const { name } = req.body;
        const apiKey = generateApiKey();
        const pkId = req.user!.pkId;

        await prisma.device.create({
            data: {
                apiKey,
                name,
                labels: {},
                serverId: 1,
                user: { connect: { pkId } },
            },
        });
        res.status(201).json({ message: 'Device created successfully' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

// export const deleteDevice: RequestHandler = async (req, res) => {

// }
