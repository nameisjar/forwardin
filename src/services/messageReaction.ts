import prisma from '../utils/db';

export interface MessageReactionState {
    targetMessageId: string;
    targetFromMe: boolean;
    reactorJid: string;
    reactorDisplayName?: string | null;
    reactorPhone?: string | null;
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

const normalizeReactionPhone = (value: string | null | undefined): string =>
    String(value || '')
        .split('@')[0]
        .split(':')[0]
        .replace(/\D/g, '');

const getContactDisplayName = (contact: {
    firstName: string;
    lastName: string | null;
} | null | undefined): string | null => {
    if (!contact) return null;
    return [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || null;
};

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
            "target_from_me", "reactor_jid", "emoji", "reaction_message_id", "reacted_at",
            "created_at", "updated_at"
        ) VALUES (
            ${input.deviceId}, ${input.sessionId}, ${input.conversationJid},
            ${input.targetMessageId}, ${input.targetFromMe}, ${input.reactorJid},
            ${emoji}, ${input.reactionMessageId || null}, ${input.reactedAt},
            CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
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
    const reactions = rows.map(serializeReaction);
    const reactorJids = [
        ...new Set(
            reactions
                .map((reaction) => reaction.reactorJid)
                .filter((jid) => jid && jid !== 'me'),
        ),
    ];
    const reactorPhones = [
        ...new Set(reactorJids.map(normalizeReactionPhone).filter(Boolean)),
    ];

    if (reactorJids.length === 0) {
        return reactions.map((reaction) => ({
            ...reaction,
            reactorDisplayName: reaction.reactorJid === 'me' ? 'Anda' : null,
            reactorPhone: null,
        }));
    }

    const contactPhoneCandidates = [
        ...new Set(reactorPhones.flatMap((phone) => [phone, `+${phone}`])),
    ];
    const [contacts, incomingIdentities] = await Promise.all([
        contactPhoneCandidates.length > 0
            ? prisma.contact.findMany({
                  where: {
                      phone: { in: contactPhoneCandidates },
                      contactDevices: { some: { deviceId } },
                  },
                  select: { firstName: true, lastName: true, phone: true },
              })
            : Promise.resolve([]),
        prisma.incomingMessage.findMany({
            where: {
                deviceId,
                OR: [
                    { participant: { in: reactorJids } },
                    { from: { in: reactorJids } },
                ],
            },
            orderBy: { receivedAt: 'desc' },
            select: {
                from: true,
                participant: true,
                pushName: true,
                contact: {
                    select: { firstName: true, lastName: true, phone: true },
                },
            },
        }),
    ]);

    const contactsByPhone = new Map(
        contacts.map((contact) => [normalizeReactionPhone(contact.phone), contact]),
    );
    const identitiesByKey = new Map<string, (typeof incomingIdentities)[number]>();
    for (const identity of incomingIdentities) {
        for (const value of [identity.participant, identity.from]) {
            if (!value) continue;
            const jidKey = value.toLowerCase();
            const phoneKey = normalizeReactionPhone(value);
            if (!identitiesByKey.has(jidKey)) identitiesByKey.set(jidKey, identity);
            if (phoneKey && !identitiesByKey.has(phoneKey)) {
                identitiesByKey.set(phoneKey, identity);
            }
        }
    }

    return reactions.map((reaction) => {
        if (reaction.reactorJid === 'me') {
            return { ...reaction, reactorDisplayName: 'Anda', reactorPhone: null };
        }

        const reactorPhone = normalizeReactionPhone(reaction.reactorJid) || null;
        const identity = identitiesByKey.get(reaction.reactorJid.toLowerCase())
            || (reactorPhone ? identitiesByKey.get(reactorPhone) : undefined);
        const contact = (reactorPhone ? contactsByPhone.get(reactorPhone) : undefined)
            || identity?.contact;
        const reactorDisplayName = getContactDisplayName(contact)
            || identity?.pushName?.trim()
            || null;

        return {
            ...reaction,
            reactorDisplayName,
            reactorPhone,
        };
    });
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
