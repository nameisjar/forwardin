import { PrismaClient } from '@prisma/client';
import { seedSubscriptionPlans } from './subscriptionPlan';
import { seedPrivileges } from './privilege';

async function seedDatabase() {
    const prisma = new PrismaClient();

    try {
        await prisma.subscription.deleteMany();
        await prisma.privilege.deleteMany();

        await seedSubscriptionPlans(prisma);
        await seedPrivileges(prisma);
    } catch (error) {
        console.error('Seeder error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

seedDatabase();
