import { PrismaClient } from '@prisma/client';

async function seedSubscriptions(prisma: PrismaClient) {
    await prisma.subscription.createMany({
        data: [
            {
                name: 'Free',
                price: 0,
                isAvailable: true,
            },
            {
                name: 'Premium',
                price: 19.99,
                isAvailable: true,
            },
        ],
    });
}

export { seedSubscriptions };
