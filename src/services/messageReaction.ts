import prisma from '../utils/db';

export interface MessageReactionState {
    targetMessageId: string;
    targetFromMe: boolean;
    reactorJid: string;
    emoji: string;
    reactionMessageId: string | null;
    reactedAt: string;
}

interface MessageReactionRow {
    target_message_id: string;
    target_from_me: boolean;
    reactor_jid: string;
    emoji: string;
    reaction_message_id: string | null;
    reacted_at: Date;
}

interface SaveMessageReactionInput {
    deviceId: number;
    sessionId: string;
    conversationJid: string;
    targetMessageId: string;
    targetFromMe: boolean;
    reactorJid: string;
    emoji?: string | null;
    reactionMessageId?: string | null;
    reactedAt: Date;
}

const serializeReaction = (row: MessageReactionRow): MessageReactionState => ({
    targetMessageId: row.target_message_id,
    targetFromMe: row.target_from_me,
    reactorJid: row.reactor_jid,
    emoji: row.emoji,
    reactionMessageId: row.reaction_message_id,
    reactedAt: row.reacted_at.toISOString(),
});

export const reactionTimestamp = (value: unknown): Date => {
    let numericValue: number;
    if (typeof value === 'object' && value && 'toNumber' in value) {
        numericValue = Number((value as { toNumber: () => number }).toNumber());
    } else {
        numericValue = Number(value);
    }

    if (!Number.isFinite(numericValue) || numericValue <= 0) return new Date();
    return new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue);
};

export const saveMessageReaction = async (
    input: SaveMessageReactionInput,
): Promise<MessageReactionState & { removed: boolean }> => {
    const emoji = input.emoji?.trim() || '';
    if (!emoji) {
        await prisma.$executeRaw`
            DELETE FROM "message_reaction"
            WHERE "device_id" = ${input.deviceId}
              AND "session_id" = ${input.sessionId}
              AND "target_message_id" = ${input.targetMessageId}
              AND "reactor_jid" = ${input.reactorJid}
        `;
        return {
            targetMessageId: input.targetMessageId,
            targetFromMe: input.targetFromMe,
            reactorJid: input.reactorJid,
            emoji: '',
            reactionMessageId: input.reactionMessageId || null,
            reactedAt: input.reactedAt.toISOString(),
            removed: true,
        };
    }

    const rows = await prisma.$queryRaw<MessageReactionRow[]>`
        INSERT INTO "message_reaction" (
            "device_id", "session_id", "conversation_jid", "target_message_id",
            "target_from_me", "reactor_jid", "emoji", "reaction_message_id", "reacted_at"
        ) VALUES (
            ${input.deviceId}, ${input.sessionId}, ${input.conversationJid},
            ${input.targetMessageId}, ${input.targetFromMe}, ${input.reactorJid},
            ${emoji}, ${input.reactionMessageId || null}, ${input.reactedAt}
        )
        ON CONFLICT ("device_id", "session_id", "target_message_id", "reactor_jid")
        DO UPDATE SET
            "conversation_jid" = EXCLUDED."conversation_jid",
            "target_from_me" = EXCLUDED."target_from_me",
            "emoji" = EXCLUDED."emoji",
            "reaction_message_id" = EXCLUDED."reaction_message_id",
            "reacted_at" = EXCLUDED."reacted_at",
            "updated_at" = CURRENT_TIMESTAMP
        RETURNING
            "target_message_id", "target_from_me", "reactor_jid", "emoji",
            "reaction_message_id", "reacted_at"
    `;

    return { ...serializeReaction(rows[0]), removed: false };
};

export const getConversationMessageReactions = async (
    deviceId: number,
    conversationJid: string,
): Promise<MessageReactionState[]> => {
    const rows = await prisma.$queryRaw<MessageReactionRow[]>`
        SELECT
            "target_message_id", "target_from_me", "reactor_jid", "emoji",
            "reaction_message_id", "reacted_at"
        FROM "message_reaction"
        WHERE "device_id" = ${deviceId}
          AND "conversation_jid" = ${conversationJid}
        ORDER BY "reacted_at" ASC
    `;
    return rows.map(serializeReaction);
};

export const deleteReactionPlaceholder = async (input: {
    deviceId: number;
    sessionId: string;
    reactionMessageId?: string | null;
}): Promise<void> => {
    if (!input.reactionMessageId) return;
    await Promise.all([
        prisma.incomingMessage.deleteMany({
            where: { deviceId: input.deviceId, id: input.reactionMessageId },
        }),
        prisma.outgoingMessage.deleteMany({
            where: {
                sessionId: input.sessionId,
                OR: [
                    { id: input.reactionMessageId },
                    { waMessageId: input.reactionMessageId },
                ],
            },
        }),
    ]);
};

export const deleteConversationReactions = (deviceId: number, conversationJid: string) =>
    prisma.$executeRaw`
        DELETE FROM "message_reaction"
        WHERE "device_id" = ${deviceId}
          AND "conversation_jid" = ${conversationJid}
    `;

export const deleteAllDeviceReactions = (deviceId: number) =>
    prisma.$executeRaw`
        DELETE FROM "message_reaction"
        WHERE "device_id" = ${deviceId}
    `;

export const deleteMessageReactions = (
    deviceId: number,
    sessionId: string,
    targetMessageId: string,
) =>
    prisma.$executeRaw`
        DELETE FROM "message_reaction"
        WHERE "device_id" = ${deviceId}
          AND "session_id" = ${sessionId}
          AND "target_message_id" = ${targetMessageId}
    `;
