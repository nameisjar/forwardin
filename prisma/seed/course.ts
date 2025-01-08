import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';

async function seedReminderPythonPro1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'python pro 1',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python pro 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Python Pro 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}
async function seedReminderPythonStart1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'python start 1',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Python Start 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}
async function seedReminderVisualProgramming(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'visual programming',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'visual programming',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Visual Programming seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedReminderCodingKnight(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'coding knight',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'coding knight',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Coding Knight seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedReminderPythonStart2(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseReminder.createMany({
            data: [
                {
                    courseName: 'python start 2',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 2',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Reminder Python Start 2 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackPythonPro1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'python pro 1',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python pro 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python pro 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Python Pro 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackPythonStart1(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'python start 1',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 1',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 1',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Python Start 1 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackPythonStart2(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'python start 2',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'python start 2',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'python start 2',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Python Start 2 seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackVisualProgramming(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'visual programming',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'visual programming',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'visual programming',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Visual Programming seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

async function seedFeedbackCodingKnight(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.courseFeedback.createMany({
            data: [
                {
                    courseName: 'coding knight',
                    lesson: 1,
                    message: "Don't forget to solve the quadratic equation.",
                },
                {
                    courseName: 'coding knight',
                    lesson: 2,
                    message: 'Remember to do the experiment.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 3,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 4,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 5,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 6,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 7,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 8,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 9,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 10,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 11,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 12,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 13,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 14,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 15,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 16,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 17,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 18,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 19,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 20,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 21,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 22,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 23,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 24,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 25,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 26,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 27,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 29,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 30,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 31,
                    message: 'Prepare for the quiz.',
                },
                {
                    courseName: 'coding knight',
                    lesson: 32,
                    message: 'Prepare for the quiz.',
                },
            ],
        });
        logger.info('Feedback Coding Knight seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    }
}

export {
    seedReminderPythonPro1,
    seedReminderPythonStart1,
    seedReminderVisualProgramming,
    seedReminderCodingKnight,
    seedReminderPythonStart2,
    seedFeedbackPythonPro1,
    seedFeedbackPythonStart1,
    seedFeedbackPythonStart2,
    seedFeedbackVisualProgramming,
    seedFeedbackCodingKnight,
};
