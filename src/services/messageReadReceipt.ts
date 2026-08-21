import { Prisma } from '@prisma/client';
import prisma from '../utils/db';
import {
    isOwnWhatsAppIdentity,
    whatsappIdentityPhone,
} from '../utils/whatsappIdentity';

export interface StoredMessageReadReceipt {
    readerJid: string;
    readAt: string;
    estimated: boolean;
}

export interface ResolvedMessageReadReceipt extends StoredMessageReadReceipt {
    readerDisplayName: string | null;
    readerPhone: string | null;
    profileJid: string | null;
}

type IncomingReaderIdentity = {
    from: string;
    participant: string | null;
    pushName: string | null;
    contact: {
        firstName: string;
        lastName: string | null;
        phone: string;
    } | null;
    editSecret: {
        senderJid: string;
        senderAltJid: string | null;
    } | null;
};

const asIsoDate = (value: unknown): string | null => {
    const date = value instanceof Date ? value : new Date(String(value || ''));
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
};

export const receiptTimestamp = (value: unknown): {
    date: Date;
    estimated: boolean;
} => {
    let numericValue: number;
    if (typeof value === 'object' && value && 'toNumber' in value) {
        numericValue = Number((value as { toNumber: () => number }).toNumber());
    } else {
        numericValue = Number(value);
    }

    if (!Number.isFinite(numericValue) || numericValue <= 0) {
        return { date: new Date(), estimated: true };
    }

    return {
        date: new Date(numericValue < 1_000_000_000_000 ? numericValue * 1000 : numericValue),
        estimated: false,
    };
};

export const parseMessageReadReceipts = (
    value: unknown,
): StoredMessageReadReceipt[] => {
    if (!Array.isArray(value)) return [];

    const receipts = new Map<string, StoredMessageReadReceipt>();
    for (const item of value) {
        if (!item || typeof item !== 'object') continue;
        const candidate = item as Record<string, unknown>;
        const readerJid = String(candidate.readerJid || '').trim();
        const readAt = asIsoDate(candidate.readAt);
        if (!readerJid || !readAt) continue;

        receipts.set(readerJid.toLowerCase(), {
            readerJid,
            readAt,
            estimated: candidate.estimated === true,
        });
    }
    return [...receipts.values()];
};

export const upsertMessageReadReceipt = (
    current: unknown,
    input: StoredMessageReadReceipt,
): StoredMessageReadReceipt[] => {
    const next = parseMessageReadReceipts(current);
    const key = input.readerJid.trim().toLowerCase();
    if (!key) return next;

    const index = next.findIndex((receipt) => receipt.readerJid.toLowerCase() === key);
    if (index === -1) return [...next, input];

    const existing = next[index];
    const shouldReplace =
        (existing.estimated && !input.estimated)
        || (existing.estimated === input.estimated
            && new Date(input.readAt).getTime() < new Date(existing.readAt).getTime());
    if (shouldReplace) next[index] = input;
    return next;
};

export const normalizeReadReceiptPhone = (
    value: string | null | undefined,
): string => whatsappIdentityPhone(value);

export const filterOwnMessageReadReceipts = (
    value: unknown,
    ownIdentityJids: readonly string[],
): StoredMessageReadReceipt[] => parseMessageReadReceipts(value).filter(
    (receipt) => !isOwnWhatsAppIdentity(receipt.readerJid, ownIdentityJids),
);

export const filterOwnReadBy = (
    value: unknown,
    ownIdentityJids: readonly string[],
): string[] => (Array.isArray(value) ? value : [])
    .map((readerJid) => String(readerJid || '').trim())
    .filter(
        (readerJid) => readerJid && !isOwnWhatsAppIdentity(readerJid, ownIdentityJids),
    );

const identityJids = (identity: IncomingReaderIdentity | null | undefined) => [
    identity?.editSecret?.senderJid,
    identity?.editSecret?.senderAltJid,
    identity?.participant,
    identity?.from,
].filter((jid): jid is string => Boolean(jid));

const contactName = (contact: {
    firstName: string;
    lastName: string | null;
} | null | undefined) => contact
    ? [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim() || null
    : null;

export const resolveMessageReadReceipts = async (
    deviceId: number,
    receipts: StoredMessageReadReceipt[],
): Promise<ResolvedMessageReadReceipt[]> => {
    const readerJids = [...new Set(receipts.map((receipt) => receipt.readerJid).filter(Boolean))];
    if (readerJids.length === 0) return [];

    const directPhones = [
        ...new Set(readerJids.map(normalizeReadReceiptPhone).filter(Boolean)),
    ];
    const identityJidsToFind = readerJids.filter((jid) => !jid.endsWith('@g.us'));
    const exactFilters: Prisma.IncomingMessageWhereInput[] = [
        { participant: { in: identityJidsToFind } },
        { from: { in: identityJidsToFind } },
        { editSecret: { is: { senderJid: { in: identityJidsToFind } } } },
        { editSecret: { is: { senderAltJid: { in: identityJidsToFind } } } },
    ];
    const phoneFilters: Prisma.IncomingMessageWhereInput[] = directPhones.flatMap((phone) => [
        { participant: { startsWith: phone } },
        { from: { startsWith: phone } },
        { editSecret: { is: { senderJid: { startsWith: phone } } } },
        { editSecret: { is: { senderAltJid: { startsWith: phone } } } },
    ]);

    const [incomingIdentities, conversationIdentities] = await Promise.all([
        prisma.incomingMessage.findMany({
            where: { deviceId, OR: [...exactFilters, ...phoneFilters] },
            orderBy: { receivedAt: 'desc' },
            select: {
                from: true,
                participant: true,
                pushName: true,
                contact: { select: { firstName: true, lastName: true, phone: true } },
                editSecret: { select: { senderJid: true, senderAltJid: true } },
            },
        }),
        prisma.conversation.findMany({
            where: {
                deviceId,
                isGroup: false,
                OR: [
                    { jid: { in: identityJidsToFind } },
                    ...directPhones.map((phone) => ({ jid: { startsWith: phone } })),
                ],
            },
            orderBy: { updatedAt: 'desc' },
            select: {
                jid: true,
                pushName: true,
                contact: { select: { firstName: true, lastName: true, phone: true } },
            },
        }),
    ]);

    const allPhones = [
        ...new Set([
            ...directPhones,
            ...incomingIdentities.flatMap((identity) =>
                identityJids(identity).map(normalizeReadReceiptPhone),
            ).filter(Boolean),
        ]),
    ];
    const contacts = allPhones.length > 0
        ? await prisma.contact.findMany({
              where: {
                  phone: { in: [...allPhones, ...allPhones.map((phone) => `+${phone}`)] },
                  contactDevices: { some: { deviceId } },
              },
              select: { firstName: true, lastName: true, phone: true },
          })
        : [];
    const contactsByPhone = new Map(
        contacts.map((contact) => [normalizeReadReceiptPhone(contact.phone), contact]),
    );

    const identitiesByKey = new Map<string, (typeof incomingIdentities)[number]>();
    for (const identity of incomingIdentities) {
        for (const jid of identityJids(identity)) {
            const jidKey = jid.toLowerCase();
            const phoneKey = normalizeReadReceiptPhone(jid);
            if (!identitiesByKey.has(jidKey)) identitiesByKey.set(jidKey, identity);
            if (phoneKey && !identitiesByKey.has(phoneKey)) identitiesByKey.set(phoneKey, identity);
        }
    }
    const conversationsByKey = new Map<string, (typeof conversationIdentities)[number]>();
    for (const conversation of conversationIdentities) {
        const phone = normalizeReadReceiptPhone(conversation.jid);
        conversationsByKey.set(conversation.jid.toLowerCase(), conversation);
        if (phone && !conversationsByKey.has(phone)) conversationsByKey.set(phone, conversation);
    }

    const resolved = receipts.map((receipt) => {
        const directPhone = normalizeReadReceiptPhone(receipt.readerJid);
        const identity = identitiesByKey.get(receipt.readerJid.toLowerCase())
            || (directPhone ? identitiesByKey.get(directPhone) : undefined);
        const conversation = conversationsByKey.get(receipt.readerJid.toLowerCase())
            || (directPhone ? conversationsByKey.get(directPhone) : undefined);
        const readerPhone = directPhone
            || identityJids(identity).map(normalizeReadReceiptPhone).find(Boolean)
            || normalizeReadReceiptPhone(conversation?.jid)
            || null;
        const contact = (readerPhone ? contactsByPhone.get(readerPhone) : undefined)
            || identity?.contact
            || conversation?.contact;
        return {
            ...receipt,
            readerDisplayName: contactName(contact)
                || identity?.pushName?.trim()
                || conversation?.pushName?.trim()
                || null,
            readerPhone,
            profileJid: readerPhone
                ? `${readerPhone}@s.whatsapp.net`
                : receipt.readerJid.endsWith('@lid') || receipt.readerJid.endsWith('@g.us')
                    ? null
                    : receipt.readerJid,
        };
    });

    const deduplicated = new Map<string, ResolvedMessageReadReceipt>();
    for (const receipt of resolved) {
        const key = receipt.readerPhone || receipt.readerJid.toLowerCase();
        const current = deduplicated.get(key);
        if (!current || new Date(receipt.readAt) < new Date(current.readAt)) {
            deduplicated.set(key, receipt);
        }
    }
    return [...deduplicated.values()].sort(
        (a, b) => new Date(b.readAt).getTime() - new Date(a.readAt).getTime(),
    );
};
