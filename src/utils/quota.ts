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

export async function useAutoReply(transaction: any, subscription: Subscription) {
    await transaction.subscription.update({
        where: { pkId: subscription.pkId },
        data: {
            autoReplyUsed: subscription.autoReplyUsed + 1,
            updatedAt: new Date(),
        },
    });
}

export async function useBroadcast(transaction: any, subscription: Subscription) {
    await transaction.subscription.update({
        where: { pkId: subscription.pkId },
        data: {
            broadcastUsed: subscription.broadcastUsed + 1,
            updatedAt: new Date(),
        },
    });
}

export async function useContact(transaction: any, subscription: Subscription, increment?: number) {
    await transaction.subscription.update({
        where: { pkId: subscription.pkId },
        data: {
            contactUsed: increment ?? subscription.contactUsed + 1,
            updatedAt: new Date(),
        },
    });
}
