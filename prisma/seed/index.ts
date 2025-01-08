import { PrismaClient } from '@prisma/client';
import { seedSubscriptionPlans } from './subscriptionPlan';
import { seedPrivileges } from './privilege';
import { seedAdminAccount } from './admin';
import logger from '../../src/config/logger';
import { seedUserAccount } from './user';
import {
    seedFeedbackCodingKnight,
    seedFeedbackPythonPro1,
    seedFeedbackPythonStart1,
    seedFeedbackPythonStart2,
    seedFeedbackVisualProgramming,
    seedReminderCodingKnight,
    seedReminderPythonPro1,
    seedReminderPythonStart1,
    seedReminderPythonStart2,
    seedReminderVisualProgramming,
} from './course';

async function seedDatabase() {
    const prisma = new PrismaClient();

    try {
        await prisma.subscriptionPlan.deleteMany();
        await prisma.privilege.deleteMany();
        await prisma.user.deleteMany();

        await seedSubscriptionPlans(prisma, logger);
        await seedPrivileges(prisma, logger);
        await seedAdminAccount(prisma, logger);
        await seedUserAccount(prisma, logger);
        await seedReminderPythonPro1(prisma, logger);
        await seedReminderPythonStart1(prisma, logger);
        await seedReminderPythonStart2(prisma, logger);
        await seedReminderVisualProgramming(prisma, logger);
        await seedReminderCodingKnight(prisma, logger);
        await seedFeedbackCodingKnight(prisma, logger);
        await seedFeedbackPythonPro1(prisma, logger);
        await seedFeedbackPythonStart1(prisma, logger);
        await seedFeedbackPythonStart2(prisma, logger);
        await seedFeedbackVisualProgramming(prisma, logger);
    } catch (error) {
        logger.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

seedDatabase();
