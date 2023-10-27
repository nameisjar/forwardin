import { PrismaClient } from '@prisma/client';

async function seedSubscriptionPlans(prisma: PrismaClient) {
    await prisma.subscriptionPlan.createMany({
        data: [
            {
                name: 'starter',
                monthlyPrice: 0,
                yearlyPrice: 0,
                autoReplyQuota: 10,
                broadcastQuota: 5,
                contactQuota: 50,
                deviceQuota: 5,
                isIntegration: false,
                isGoogleContactSync: false,
                isWhatsappContactSync: false,
                isAvailable: true,
            },
            {
                name: 'basic',
                monthlyPrice: 65000,
                yearlyPrice: 650000,
                autoReplyQuota: 4500,
                broadcastQuota: 2500,
                contactQuota: 1000,
                deviceQuota: 15,
                isIntegration: true,
                isGoogleContactSync: true,
                isWhatsappContactSync: false,
                isAvailable: true,
            },
            {
                name: 'premium',
                monthlyPrice: 76000,
                yearlyPrice: 800000,
                autoReplyQuota: 9500,
                broadcastQuota: 5500,
                contactQuota: 5000,
                deviceQuota: 50,
                isIntegration: true,
                isGoogleContactSync: true,
                isWhatsappContactSync: true,
                isAvailable: true,
            },
            {
                name: 'pro',
                monthlyPrice: 86000,
                yearlyPrice: 900000,
                autoReplyQuota: 20000,
                broadcastQuota: 14500,
                contactQuota: 15000,
                deviceQuota: 100,
                isIntegration: true,
                isGoogleContactSync: true,
                isWhatsappContactSync: true,
                isAvailable: true,
            },
        ],
    });
}

export { seedSubscriptionPlans };
