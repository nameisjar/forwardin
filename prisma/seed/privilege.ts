import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';

async function seedPrivileges(prisma: PrismaClient, logger: Logger) {
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

        logger.info('Privilege seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

export { seedPrivileges };
