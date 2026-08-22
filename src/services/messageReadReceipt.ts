import { Prisma } from '@prisma/client';
import prisma from '../utils/db';
import {
    canonicalPersonalPhoneJid,
    isOwnWhatsAppIdentity,
    whatsappIdentityPhone,
} from '../utils/whatsappIdentity';

export interface StoredMessageReadReceipt {
    readerJid: string;
    readAt: string;
    estimated: boolean;
    readerDisplayName?: string | null;
    readerPhone?: string | null;
    profileJid?: string | null;
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

type GroupReaderIdentity = {
    id: string;
    lid?: string | null;
    phoneNumber?: string | null;
    name?: string | null;
    notify?: string | null;
    verifiedName?: string | null;
};

type ReadReceiptIdentitySession = {
    signalRepository?: {
        lidMapping?: {
            getPNForLID?: (jid: string) => Promise<string | null | undefined>;
        };
    };
    groupMetadata?: (jid: string) => Promise<{
        participants?: GroupReaderIdentity[];
    }>;
};

export type ReadReceiptIdentityAlias = {
    readerPhone: string | null;
    phoneJid: string | null;
    readerDisplayName: string | null;
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

        const readerPhone = whatsappIdentityPhone(String(candidate.readerPhone || ''));
        const readerDisplayName = String(candidate.readerDisplayName || '').trim();
        const profileJid = canonicalPersonalPhoneJid(String(candidate.profileJid || ''));

        receipts.set(readerJid.toLowerCase(), {
            readerJid,
            readAt,
            estimated: candidate.estimated === true,
            ...(readerDisplayName ? { readerDisplayName } : {}),
            ...(readerPhone ? { readerPhone } : {}),
            ...(profileJid ? { profileJid } : {}),
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

const comparableJid = (value: string | null | undefined): string => {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized.includes('@')) return normalized;
    const [localPart, domain] = normalized.split('@');
    return `${localPart.split(':')[0]}@${domain}`;
};

const groupReaderName = (identity: GroupReaderIdentity | undefined): string | null => {
    if (!identity) return null;
    return [identity.name, identity.notify, identity.verifiedName]
        .map((value) => String(value || '').trim())
        .find(Boolean) || null;
};

/** Resolve private WhatsApp LIDs to their public phone identities while online. */
export const resolveReadReceiptIdentityAliases = async (
    session: ReadReceiptIdentitySession,
    conversationJid: string,
    readerJids: readonly string[],
): Promise<Map<string, ReadReceiptIdentityAlias>> => {
    const uniqueReaderJids = [...new Set(
        readerJids.map((jid) => String(jid || '').trim()).filter(Boolean),
    )];
    const lidReaderJids = uniqueReaderJids.filter((jid) =>
        jid.toLowerCase().endsWith('@lid') || jid.toLowerCase().endsWith('@hosted.lid'),
    );

    let participants: GroupReaderIdentity[] = [];
    if (lidReaderJids.length > 0
        && conversationJid.toLowerCase().endsWith('@g.us')
        && session.groupMetadata) {
        try {
            participants = (await session.groupMetadata(conversationJid)).participants || [];
        } catch {
            participants = [];
        }
    }

    const participantsByJid = new Map<string, GroupReaderIdentity>();
    for (const participant of participants) {
        for (const jid of [participant.id, participant.lid]) {
            const key = comparableJid(jid);
            if (key && !participantsByJid.has(key)) participantsByJid.set(key, participant);
        }
    }

    const aliases = new Map<string, ReadReceiptIdentityAlias>();
    await Promise.all(uniqueReaderJids.map(async (readerJid) => {
        const participant = participantsByJid.get(comparableJid(readerJid));
        let phoneJid = canonicalPersonalPhoneJid(readerJid);

        if (!phoneJid && session.signalRepository?.lidMapping?.getPNForLID) {
            try {
                phoneJid = canonicalPersonalPhoneJid(
                    await session.signalRepository.lidMapping.getPNForLID(readerJid),
                );
            } catch {
                phoneJid = null;
            }
        }
        phoneJid = phoneJid
            || canonicalPersonalPhoneJid(participant?.phoneNumber)
            || canonicalPersonalPhoneJid(participant?.id);

        aliases.set(readerJid.toLowerCase(), {
            readerPhone: whatsappIdentityPhone(phoneJid),
            phoneJid,
            readerDisplayName: groupReaderName(participant),
        });
    }));
    return aliases;
};

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
    identityAliases: ReadonlyMap<string, ReadReceiptIdentityAlias> = new Map(),
): Promise<ResolvedMessageReadReceipt[]> => {
    const readerJids = [...new Set(receipts.map((receipt) => receipt.readerJid).filter(Boolean))];
    if (readerJids.length === 0) return [];

    const directPhones = [...new Set(receipts.flatMap((receipt) => {
        const alias = identityAliases.get(receipt.readerJid.toLowerCase());
        return [
            normalizeReadReceiptPhone(receipt.readerJid),
            normalizeReadReceiptPhone(receipt.readerPhone),
            normalizeReadReceiptPhone(receipt.profileJid),
            alias?.readerPhone || '',
        ];
    }).filter(Boolean))];
    const aliasPhoneJids = [...identityAliases.values()]
        .map((alias) => alias.phoneJid)
        .filter((jid): jid is string => Boolean(jid));
    const identityJidsToFind = [...new Set([...readerJids, ...aliasPhoneJids])]
        .filter((jid) => !jid.endsWith('@g.us'));
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
        const alias = identityAliases.get(receipt.readerJid.toLowerCase());
        const directPhone = normalizeReadReceiptPhone(receipt.readerJid)
            || normalizeReadReceiptPhone(receipt.readerPhone)
            || normalizeReadReceiptPhone(receipt.profileJid)
            || alias?.readerPhone
            || '';
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
                || receipt.readerDisplayName?.trim()
                || alias?.readerDisplayName
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
