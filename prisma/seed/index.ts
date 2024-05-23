import { PrismaClient } from '@prisma/client';
import { seedSubscriptionPlans } from './subscriptionPlan';
import { seedPrivileges } from './privilege';
import { seedAdminAccount } from './admin';
import logger from '../../src/config/logger';
import { seedUserAccount } from './user';

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
    } catch (error) {
        logger.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

seedDatabase();
