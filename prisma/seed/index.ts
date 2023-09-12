import { PrismaClient } from '@prisma/client';
import { seedSubscriptions } from './subscription';
import { seedPrivileges } from './privilege';

async function seedDatabase() {
    const prisma = new PrismaClient();

    try {
        await seedSubscriptions(prisma);
        await seedPrivileges(prisma);
    } catch (error) {
        console.error('Seeder error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

seedDatabase();
