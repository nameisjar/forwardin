/* eslint-disable @typescript-eslint/no-explicit-any */
import { Subscription } from '@prisma/client';

export async function useDevice(transaction: any, subscription: Subscription) {
    await transaction.subscription.update({
        where: { pkId: subscription.pkId },
        data: {
            deviceUsed: subscription.deviceUsed + 1,
            updatedAt: new Date(),
        },
    });
}
