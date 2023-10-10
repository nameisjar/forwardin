import { PrismaClient } from '@prisma/client';

async function seedSubscriptions(prisma: PrismaClient) {
    await prisma.subscription.createMany({
        data: [
            {
                name: 'Starter',
                monthlyPrice: 0,
                yearlyPrice: 0,
                isAvailable: true,
            },
            {
                name: 'Basic',
                monthlyPrice: 65000,
                yearlyPrice: 650000,
                isAvailable: true,
            },
            {
                name: 'Premium',
                monthlyPrice: 76000,
                yearlyPrice: 800000,
                isAvailable: true,
            },
            {
                name: 'Pro',
                monthlyPrice: 86000,
                yearlyPrice: 900000,
                isAvailable: true,
            },
        ],
    });
}

export { seedSubscriptions };
