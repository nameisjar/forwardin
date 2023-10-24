import { PrismaClient } from '@prisma/client';
import { seedSubscriptions } from './subscription';
import { seedPrivileges } from './privilege';

async function seedDatabase() {
    const prisma = new PrismaClient();

    try {
        await prisma.subscription.deleteMany();
        await prisma.privilege.deleteMany();

        await seedSubscriptions(prisma);
        await seedPrivileges(prisma);
    } catch (error) {
        console.error('Seeder error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

seedDatabase();
