import { PrismaClient } from '@prisma/client';

async function seedPrivileges(prisma: PrismaClient) {
    try {
        await prisma.$connect();

        await prisma.privilege.createMany({
            data: [
                {
                    name: 'Super Admin',
                    isSuperadmin: true,
                },
                {
                    name: 'Admin',
                    isSuperadmin: false,
                },
            ],
        });

        console.log('Privilege seeder executed successfully.');
    } catch (error) {
        console.error('Error running privilege seeder:', error);
    } finally {
        await prisma.$disconnect();
    }
}

export { seedPrivileges };
