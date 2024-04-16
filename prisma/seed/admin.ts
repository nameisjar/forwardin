import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { generateUuid } from '../../src/utils/keyGenerator';
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '../../src/utils/jwtGenerator';

async function seedAdminAccount(prisma: PrismaClient, logger: Logger) {
    try {
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);
        const admin = await prisma.user.create({
            data: {
                firstName: 'Admin',
                lastName: 'Forwardin',
                username: 'admin',
                email: 'admin@gmail.com',
                password: hashedPassword,
                accountApiKey: generateUuid(),
                emailVerifiedAt: new Date(),
                createdAt: new Date(),
                privilegeId: 1,
            },
        });
        const refreshToken = generateAccessToken(admin);

        await prisma.user.update({
            where: {
                id: admin.id,
            },
            data: {
                refreshToken,
            },
        });

        logger.info('Admin account created');
    } catch (error) {
        console.error('Error creating admin account:', error);
    } finally {
        await prisma.$disconnect();
    }
}

export { seedAdminAccount };
