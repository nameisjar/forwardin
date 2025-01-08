import { RequestHandler } from 'express';
import prisma from '../utils/db';
import exp from 'constants';

// reminder
export const createReminder: RequestHandler = async (req, res) => {
    try {
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Buat reminder baru
        const reminder = await prisma.courseReminder.create({
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(201).json({ message: 'Reminder created successfully.', reminder });
    } catch (error: any) {
        console.error('Error creating reminder:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const getReminders: RequestHandler = async (req, res) => {
    try {
        const reminders = await prisma.courseReminder.findMany();

        return res.status(200).json({ reminders });
    } catch (error: any) {
        console.error('Error getting reminders:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const updateReminder: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Update reminder
        const reminder = await prisma.courseReminder.update({
            where: { id: id },
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(200).json({ message: 'Reminder updated successfully.', reminder });
    } catch (error: any) {
        console.error('Error updating reminder:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteReminders: RequestHandler = async (req, res) => {
    try {
        await prisma.courseReminder.deleteMany();

        return res.status(200).json({ message: 'All reminders deleted successfully.' });
    } catch (error: any) {
        console.error('Error deleting all reminders:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteReminder: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.courseReminder.delete({
            where: { id: id },
        });

        return res.status(200).json({ message: 'Reminder deleted successfully.' });
    } catch (error: any) {
        console.error('Error deleting reminder:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

// feedback
export const createFeedback: RequestHandler = async (req, res) => {
    try {
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Buat feedback baru
        const feedback = await prisma.courseFeedback.create({
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(201).json({ message: 'Feedback created successfully.', feedback });
    } catch (error: any) {
        console.error('Error creating feedback:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const getFeedbacks: RequestHandler = async (req, res) => {
    try {
        const feedbacks = await prisma.courseFeedback.findMany();

        return res.status(200).json({ feedbacks });
    } catch (error: any) {
        console.error('Error getting feedbacks:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const updateFeedback: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;
        const { courseName, lesson, message } = req.body;

        // Validasi input
        if (!courseName || !lesson || !message) {
            return res
                .status(400)
                .json({ message: 'All fields (courseName, lesson, message) are required.' });
        }

        // Update feedback
        const feedback = await prisma.courseFeedback.update({
            where: { id: id },
            data: {
                courseName,
                lesson,
                message,
            },
        });

        return res.status(200).json({ message: 'Feedback updated successfully.', feedback });
    } catch (error: any) {
        console.error('Error updating feedback:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteFeedbacks: RequestHandler = async (req, res) => {
    try {
        await prisma.courseFeedback.deleteMany();

        return res.status(200).json({ message: 'All feedbacks deleted successfully.' });
    } catch (error: any) {
        console.error('Error deleting all feedbacks:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};

export const deleteFeedback: RequestHandler = async (req, res) => {
    try {
        const { id } = req.params;

        await prisma.courseFeedback.delete({
            where: { id: id },
        });

        return res.status(200).json({ message: 'Feedback deleted successfully.' });
    } catch (error: any) {
        console.error('Error deleting feedback:', error.message || error);
        res.status(500).json({ message: 'Internal server error.', error: error.message || error });
    }
};
