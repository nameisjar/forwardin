/* eslint-disable @typescript-eslint/no-explicit-any */
import { Subscription } from '@prisma/client';

export async function useDevice(prisma: any, subscription: Subscription) {
    await prisma.subscription.update({
        where: { pkId: subscription.pkId },
        data: {
            deviceUsed: subscription.deviceUsed + 1,
        },
    });
}
