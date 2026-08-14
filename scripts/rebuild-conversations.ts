import prisma from '../src/utils/db';
import logger from '../src/config/logger';

type ConversationKey = {
    deviceId: number;
    jid: string;
};

function readBatchSize(): number {
    const argument = process.argv.find((item) => item.startsWith('--batch='));
    const parsed = Number(argument?.split('=')[1] || 250);
    return Math.min(1000, Math.max(1, Number.isFinite(parsed) ? Math.floor(parsed) : 250));
}

async function main() {
    const batchSize = readBatchSize();
    const keys = await prisma.$queryRaw<ConversationKey[]>`
        SELECT DISTINCT source."deviceId", source.jid
        FROM (
            SELECT "device_id" AS "deviceId", "from" AS jid
            FROM "IncomingMessage"
            WHERE "device_id" IS NOT NULL

            UNION

            SELECT "device_id" AS "deviceId", "to" AS jid
            FROM "OutgoingMessage"
            WHERE "device_id" IS NOT NULL

            UNION

            SELECT "device_id" AS "deviceId", "jid" AS jid
            FROM "Conversation"
        ) source
        ORDER BY source."deviceId", source.jid
    `;

    logger.info(
        { conversations: keys.length, batchSize },
        '[ConversationRebuild] Starting reconciliation',
    );

    for (let offset = 0; offset < keys.length; offset += batchSize) {
        const batch = keys.slice(offset, offset + batchSize);
        await Promise.all(
            batch.map((key) => prisma.$queryRaw`
                SELECT refresh_conversation_summary(${key.deviceId}, ${key.jid})
            `),
        );
        logger.info(
            { processed: Math.min(offset + batch.length, keys.length), total: keys.length },
            '[ConversationRebuild] Progress',
        );
    }

    logger.info('[ConversationRebuild] Reconciliation completed');
}

main()
    .catch((error) => {
        logger.error({ error }, '[ConversationRebuild] Failed');
        process.exitCode = 1;
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
