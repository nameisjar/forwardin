import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import fs from 'fs';
import path from 'path';

async function seedPrivileges(prisma: PrismaClient, logger: Logger) {
    try {
        await prisma.$connect();

        const privilegesData = [
            {
                pkId: Number(process.env.SUPER_ADMIN_ID),
                name: 'super admin',
            },
            {
                pkId: Number(process.env.ADMIN_ID),
                name: 'admin',
            },
            {
                pkId: Number(process.env.CS_ID),
                name: 'cs',
            },
        ];

        const controllerDirectory = '../../src/controllers';
        const controllerFiles = fs.readdirSync(path.join(__dirname, controllerDirectory));

        // Create privileges and modules and store their PK IDs in maps
        const privilegeIds: number[] = [];
        const moduleIdMap = new Map();

        // Create privileges and modules
        for (const privilegeData of privilegesData) {
            const privilege = await prisma.privilege.create({
                data: privilegeData,
                select: {
                    pkId: true,
                },
            });
            privilegeIds.push(privilege.pkId);
        }

        await prisma.module.deleteMany();
        for (const controllerFile of controllerFiles) {
            const controllerName = path.parse(controllerFile).name;
            const module = await prisma.module.create({
                data: {
                    name: controllerName.charAt(0).toUpperCase() + controllerName.slice(1),
                    controller: controllerName,
                },
                select: {
                    pkId: true,
                    controller: true,
                },
            });
            moduleIdMap.set(module.controller, module.pkId);
        }

        await prisma.privilegeRole.deleteMany();
        for (const privilegeId of privilegeIds) {
            for (const [controllerName, moduleId] of moduleIdMap) {
                const isSuperAdmin = privilegeId === 0;
                const superAdminOnlyControllers = ['subscriptionPlan'];
                const isSuperAdminOnlyController =
                    superAdminOnlyControllers.includes(controllerName);

                const isVisible = isSuperAdmin || (!isSuperAdmin && !isSuperAdminOnlyController);
                const isCreate = isSuperAdmin || (!isSuperAdmin && !isSuperAdminOnlyController);
                const isRead = isSuperAdmin || (!isSuperAdmin && !isSuperAdminOnlyController);
                const isEdit = isSuperAdmin || (!isSuperAdmin && !isSuperAdminOnlyController);
                const isDelete =
                    isSuperAdmin ||
                    (!isSuperAdmin && !isSuperAdminOnlyController && controllerName !== 'user');

                await prisma.privilegeRole.create({
                    data: {
                        moduleId,
                        isVisible,
                        isCreate,
                        isDelete,
                        isRead,
                        isEdit,
                        privilegeId,
                    },
                });
            }
        }

        logger.info('Privilege seeder executed successfully.');
    } catch (error) {
        logger.error(error);
    } finally {
        await prisma.$disconnect();
    }
}

export { seedPrivileges };
