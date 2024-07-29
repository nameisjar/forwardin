import { PrismaClient } from '@prisma/client';
import { Logger } from 'pino';
import { generateUuid } from '../../src/utils/keyGenerator';
import bcrypt from 'bcrypt';
import { generateAccessToken, generateRefreshToken } from '../../src/utils/jwtGenerator';

async function seedUserAccount(prisma: PrismaClient, logger: Logger) {
    try {
        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);
        const user = await prisma.user.create({
            data: {
                firstName: 'Hola',
                lastName: 'Halo',
                username: 'Hai',
                email: 'nkgaming04@gmail.com',
                password: hashedPassword,
                affiliationCode: 'user',
                accountApiKey: generateUuid(),
                emailVerifiedAt: new Date(),
                createdAt: new Date(),
                privilegeId: 2,
            },
        });
        const refreshToken = generateAccessToken(user);

        await prisma.$transaction(async (prisma) => {
            await prisma.user.update({
                where: {
                    id: user.id,
                },
                data: {
                    refreshToken,
                },
            });
            //create device
            await prisma.device.create({
                data: {
                    name: 'Device 1',
                    userId: user.pkId,
                    apiKey: generateUuid(),
                    createdAt: new Date(),
                },
            });
        });

        logger.info('User account created');
    } catch (error) {
        console.error('Error creating user account:', error);
    } finally {
        await prisma.$disconnect();
    }
}

export { seedUserAccount };
