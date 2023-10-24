import { PrismaClient } from '@prisma/client';

async function seedPrivileges(prisma: PrismaClient) {
    try {
        await prisma.$connect();

        await prisma.privilege.createMany({
            data: [
                {
                    name: 'super admin',
                    isSuperadmin: true,
                },
                {
                    name: 'admin',
                    isSuperadmin: false,
                },
                {
                    name: 'cs',
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
