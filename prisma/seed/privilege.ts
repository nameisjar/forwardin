import { PrismaClient } from '@prisma/client';

async function seedPrivileges(prisma: PrismaClient) {
    try {
        await prisma.$connect();

        await prisma.privilege.create({
            data: {
                name: 'Super Admin',
                isSuperadmin: true,
            },
        });

        console.log('Privilege seeder executed successfully.');
    } catch (error) {
        console.error('Error running privilege seeder:', error);
    } finally {
        await prisma.$disconnect();
    }
}

export { seedPrivileges };
