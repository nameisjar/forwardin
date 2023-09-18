import { RequestHandler } from 'express';
import { connectToWhatsApp } from '../instance';

export const createSession: RequestHandler = async (req, res) => {
    try {
        const { sessionId, deviceId } = req.body;
        connectToWhatsApp(sessionId, deviceId);
        res.status(201).json({ message: 'Session created successfully.' });
    } catch (error) {
        console.error('Error:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
