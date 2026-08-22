import { createCipheriv, createHash, createHmac, randomBytes } from 'crypto';
import type { Prisma } from '@prisma/client';
import type { WAMessageKey, WASocket } from '@whiskeysockets/baileys';
import {
    decryptPollVote,
    getKeyAuthor,
    jidNormalizedUser,
    proto,
} from '@whiskeysockets/baileys';
import prisma from '../utils/db';
import { decrypt, encrypt } from '../utils/encryption';
import { createInboxProfileUrl } from '../utils/inboxMedia';
import {
    getInboxProfileCacheSummaries,
    refreshInboxProfileCache,
} from './inboxProfileCache';
import { normalizeReactionPhone } from './messageReaction';
import { waitForPollVoteDelivery } from './pollVoteDelivery';

type PollDefinition = {
    version: 1;
    question: string;
    selectableOptionsCount: number;
    options: Array<{ id: string; name: string }>;
};

export type InboxPollState = Omit<PollDefinition, 'options'> & {
    options: Array<{
        id: string;
        name: string;
        voteCount: number;
        voters: PollVoterState[];
    }>;
    totalVotes: number;
    mySelectedOptionIds: string[];
    updatedAt: string;
};

export type PollVoterState = {
    name: string;
    phone: string | null;
    profilePicUrl: string | null;
    profileStatus: 'pending' | 'available' | 'unavailable' | 'failed';
    votedAt: string;
    isMe: boolean;
};

type MessageContent = proto.IMessage | null | undefined;

type PollSocketUser = {
    id?: string | null;
    lid?: string | null;
};

const normalizeIdentityJid = (value: string | null | undefined): string => {
    const jid = String(value || '').trim();
    if (!jid || jid === 'me' || jid.endsWith('@g.us')) return jid === 'me' ? jid : '';
    return jidNormalizedUser(jid);
};

const uniqueIdentityJids = (
    values: Array<string | null | undefined>,
    preferredDomain?: '@lid' | '@s.whatsapp.net',
): string[] => {
    const normalized = [...new Set(values.map(normalizeIdentityJid).filter(Boolean))];
    if (!preferredDomain) return normalized;
    return [
        ...normalized.filter(jid => jid.endsWith(preferredDomain)),
        ...normalized.filter(jid => !jid.endsWith(preferredDomain)),
    ];
};

const expandIdentityJids = async (
    session: WASocket | null | undefined,
    values: Array<string | null | undefined>,
    preferredDomain: '@lid' | '@s.whatsapp.net',
): Promise<string[]> => {
    const candidates = uniqueIdentityJids(values);
    if (session?.signalRepository?.lidMapping) {
        const mapped: string[] = [];
        for (const jid of candidates) {
            try {
                if (jid.endsWith('@s.whatsapp.net')) {
                    mapped.push(
                        normalizeIdentityJid(
                            await session.signalRepository.lidMapping.getLIDForPN(jid),
                        ),
                    );
                } else if (jid.endsWith('@lid')) {
                    mapped.push(
                        normalizeIdentityJid(
                            await session.signalRepository.lidMapping.getPNForLID(jid),
                        ),
                    );
                }
            } catch {
                // The explicit key/session identities below remain valid fallbacks.
            }
        }
        candidates.push(...mapped.filter(Boolean));
    }
    return uniqueIdentityJids(candidates, preferredDomain);
};

/** Prefer WhatsApp's primary LID address for poll creators. */
export const messagePollCreatorJid = (input: {
    key: WAMessageKey;
    ownJid?: string | null;
    ownLid?: string | null;
}): string => {
    const primary = input.key.fromMe
        ? [input.ownLid, input.ownJid]
        : [input.key.participant, input.key.remoteJid];
    const alternate = input.key.fromMe
        ? []
        : [input.key.participantAlt, input.key.remoteJidAlt];
    return uniqueIdentityJids([...primary, ...alternate], '@lid')[0] || '';
};

export const messagePollVoterJid = (input: {
    conversationJid: string;
    pollCreatorJid: string;
    ownPnJid: string;
    ownLidJid: string;
}): string => input.conversationJid.endsWith('@g.us')
    && input.pollCreatorJid.endsWith('@lid')
    ? input.ownLidJid || input.ownPnJid
    : input.ownPnJid || input.ownLidJid;

export const messagePollCreationKey = (input: {
    conversationJid: string;
    targetMessageId: string;
    targetFromMe: boolean;
    pollCreatorJid: string;
}): WAMessageKey => ({
    remoteJid: input.conversationJid,
    id: input.targetMessageId,
    fromMe: input.targetFromMe,
    ...(input.conversationJid.endsWith('@g.us')
        ? { participant: input.pollCreatorJid }
        : {}),
});

const asBytes = (value: unknown): Uint8Array | null => {
    if (value instanceof Uint8Array) return value;
    if (Buffer.isBuffer(value)) return value;
    return null;
};

const optionId = (name: string) => createHash('sha256')
    .update(Buffer.from(name))
    .digest('base64');

const pollCreationCandidate = (
    content: MessageContent,
): proto.Message.IPollCreationMessage | null => {
    if (!content) return null;
    return content.pollCreationMessageV5
        || pollCreationCandidate(content.pollCreationMessageV4?.message)
        || content.pollCreationMessageV3
        || content.pollCreationMessageV2
        || content.pollCreationMessage
        || null;
};

/** Extract the visible, non-secret portion of all WhatsApp poll versions. */
export const extractMessagePollDefinition = (
    content: MessageContent,
): PollDefinition | null => {
    const poll = pollCreationCandidate(content);
    const question = String(poll?.name || '').trim();
    const pollOptions = poll?.options;
    const optionNames = Array.isArray(pollOptions)
        ? pollOptions
              .map(option => String(option?.optionName || '').trim())
              .filter(Boolean)
        : [];
    if (!question || optionNames.length === 0) return null;

    const requestedLimit = Number(poll?.selectableOptionsCount);
    const selectableOptionsCount = Number.isSafeInteger(requestedLimit) && requestedLimit > 0
        ? Math.min(requestedLimit, optionNames.length)
        : 1;

    return {
        version: 1,
        question,
        selectableOptionsCount,
        options: optionNames.map((name: string) => ({ id: optionId(name), name })),
    };
};

export const messagePollPreview = (definition: PollDefinition | null) =>
    definition ? `📊 Polling: ${definition.question}` : '';

type OutgoingPollContent = {
    poll: {
        name: string;
        values: string[];
        selectableCount: number;
    };
};

export class MessagePollValidationError extends Error {
    code = 'INVALID_POLL';
    statusCode = 400;

    constructor(message: string) {
        super(message);
        this.name = 'MessagePollValidationError';
    }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
    Boolean(value && typeof value === 'object' && !Array.isArray(value));

/** Validate the public poll payload accepted by the direct Inbox sender. */
export const normalizeOutgoingMessagePoll = (
    value: unknown,
): { content: OutgoingPollContent; definition: PollDefinition } | null => {
    if (!isRecord(value) || !Object.prototype.hasOwnProperty.call(value, 'poll')) return null;
    if (!isRecord(value.poll)) {
        throw new MessagePollValidationError('Format polling tidak valid');
    }

    const question = String(value.poll.name || '').trim();
    if (!question) throw new MessagePollValidationError('Pertanyaan polling wajib diisi');
    if (question.length > 255) {
        throw new MessagePollValidationError('Pertanyaan polling maksimal 255 karakter');
    }

    if (!Array.isArray(value.poll.values)) {
        throw new MessagePollValidationError('Pilihan polling tidak valid');
    }
    const values = value.poll.values.map(option => String(option || '').trim());
    if (values.length < 2 || values.length > 12) {
        throw new MessagePollValidationError('Polling harus memiliki 2 sampai 12 pilihan');
    }
    if (values.some(option => !option)) {
        throw new MessagePollValidationError('Semua pilihan polling wajib diisi');
    }
    if (values.some(option => option.length > 100)) {
        throw new MessagePollValidationError('Setiap pilihan polling maksimal 100 karakter');
    }
    const uniqueValues = new Set(values.map(option => option.toLocaleLowerCase('id-ID')));
    if (uniqueValues.size !== values.length) {
        throw new MessagePollValidationError('Pilihan polling tidak boleh sama');
    }

    const requestedLimit = Number(value.poll.selectableCount);
    if (
        !Number.isSafeInteger(requestedLimit)
        || requestedLimit < 1
        || requestedLimit > values.length
    ) {
        throw new MessagePollValidationError('Jumlah pilihan yang dapat dipilih tidak valid');
    }

    return {
        content: {
            poll: {
                name: question,
                values,
                selectableCount: requestedLimit,
            },
        },
        definition: {
            version: 1,
            question,
            selectableOptionsCount: requestedLimit,
            options: values.map(name => ({ id: optionId(name), name })),
        },
    };
};

export const createInitialMessagePollState = (
    definition: PollDefinition,
): InboxPollState => ({
    ...definition,
    options: definition.options.map(option => ({ ...option, voteCount: 0, voters: [] })),
    totalVotes: 0,
    mySelectedOptionIds: [],
    updatedAt: new Date().toISOString(),
});

const findPollSecret = (content: MessageContent): Uint8Array | null => {
    const value = content;
    const poll = pollCreationCandidate(content);
    return asBytes(value?.messageContextInfo?.messageSecret)
        || asBytes(value?.pollCreationMessageV4?.message?.messageContextInfo?.messageSecret)
        || asBytes(poll?.encKey);
};

const parseDefinition = (encryptedDefinition: string): PollDefinition | null => {
    try {
        const parsed = JSON.parse(decrypt(encryptedDefinition));
        if (
            parsed?.version !== 1
            || !String(parsed?.question || '').trim()
            || !Array.isArray(parsed?.options)
        ) return null;
        return parsed as PollDefinition;
    } catch {
        return null;
    }
};

const selectedIds = (value: Prisma.JsonValue): string[] => (
    Array.isArray(value)
        ? [...new Set(value.map(item => String(item || '')).filter(Boolean))]
        : []
);

type PollVoteRecord = {
    voterHash: string;
    encryptedVoterJid: string | null;
    encryptedVoterName: string | null;
    isOwnVote: boolean;
    selectedOptionIds: Prisma.JsonValue;
    votedAt: Date;
};

type PollStateRecord = {
    encryptedDefinition: string;
    updatedAt: Date;
    votes: PollVoteRecord[];
};

type PersistedPollIdentity = {
    from: string;
    participant: string | null;
    editSecret: {
        senderJid: string;
        senderAltJid: string | null;
    } | null;
} | null;

const getPersistedPollIdentity = (
    deviceId: number,
    targetMessageId: string,
): Promise<PersistedPollIdentity> => prisma.incomingMessage.findFirst({
    where: { deviceId, id: targetMessageId },
    select: {
        from: true,
        participant: true,
        editSecret: { select: { senderJid: true, senderAltJid: true } },
    },
});

const pollIdentityValues = (identity: PersistedPollIdentity) => identity
    ? [
          identity.editSecret?.senderJid,
          identity.participant,
          identity.editSecret?.senderAltJid,
          identity.from,
      ]
    : [];

const resolvePollCreatorJids = async (input: {
    deviceId: number;
    targetMessageId: string;
    targetFromMe: boolean;
    storedCreatorJid: string;
    creationKey?: WAMessageKey | null;
    session?: WASocket | null;
    ownJid?: string | null;
    ownLid?: string | null;
}): Promise<string[]> => {
    const identity = input.targetFromMe
        ? null
        : await getPersistedPollIdentity(input.deviceId, input.targetMessageId);
    const keyValues = input.creationKey
        ? [
              input.creationKey.participant,
              input.creationKey.remoteJid,
              input.creationKey.participantAlt,
              input.creationKey.remoteJidAlt,
          ]
        : [];
    return expandIdentityJids(
        input.session,
        input.targetFromMe
            ? [input.ownLid, input.storedCreatorJid, input.ownJid]
            : [...keyValues, ...pollIdentityValues(identity), input.storedCreatorJid],
        '@lid',
    );
};

const resolvePollVoterJids = (
    key: WAMessageKey,
    session?: WASocket | null,
    ownJid?: string | null,
    ownLid?: string | null,
) => expandIdentityJids(
    session,
    key.fromMe
        ? [ownJid, key.participantAlt, key.remoteJidAlt, ownLid]
        : [key.participantAlt, key.remoteJidAlt, key.participant, key.remoteJid],
    '@s.whatsapp.net',
);

const refreshPollVoterProfile = (
    deviceId: number,
    jid: string,
    session?: WASocket | null,
) => {
    if (!jid.endsWith('@s.whatsapp.net') || !session) return;
    void refreshInboxProfileCache({ deviceId, jid, session }).catch(() => undefined);
};

const decryptOptional = (value: string | null): string => {
    if (!value) return '';
    try {
        return decrypt(value).trim();
    } catch {
        return '';
    }
};

const identityJids = (identity: {
    from: string;
    participant: string | null;
    editSecret: { senderJid: string; senderAltJid: string | null } | null;
}) => [
    identity.editSecret?.senderJid,
    identity.editSecret?.senderAltJid,
    identity.participant,
    identity.from,
].filter((jid): jid is string => Boolean(jid && !jid.endsWith('@g.us')));

const contactName = (contact: {
    firstName: string;
    lastName: string | null;
} | null | undefined) => (
    contact
        ? [contact.firstName, contact.lastName].filter(Boolean).join(' ').trim()
        : ''
);

const resolvePollVoters = async (
    deviceId: number,
    votes: PollVoteRecord[],
): Promise<Array<PollVoteRecord & { voter: PollVoterState | null }>> => {
    const decryptedVotes = votes.map(vote => ({
        ...vote,
        voterJid: decryptOptional(vote.encryptedVoterJid),
        storedName: decryptOptional(vote.encryptedVoterName),
    }));
    const lookupJids = [...new Set(
        decryptedVotes.map(vote => vote.voterJid).filter(jid => jid && jid !== 'me'),
    )];
    const lookupPhones = [...new Set(lookupJids.map(normalizeReactionPhone).filter(Boolean))];
    const identityFilters: Prisma.IncomingMessageWhereInput[] = [
        ...(lookupJids.length > 0
            ? [
                  { participant: { in: lookupJids } },
                  { from: { in: lookupJids } },
                  { editSecret: { is: { senderJid: { in: lookupJids } } } },
                  { editSecret: { is: { senderAltJid: { in: lookupJids } } } },
              ]
            : []),
        ...lookupPhones.flatMap(phone => [
            { participant: { startsWith: phone } },
            { from: { startsWith: phone } },
            { editSecret: { is: { senderJid: { startsWith: phone } } } },
            { editSecret: { is: { senderAltJid: { startsWith: phone } } } },
        ]),
    ];
    const identities = identityFilters.length > 0
        ? await prisma.incomingMessage.findMany({
              where: { deviceId, OR: identityFilters },
              orderBy: { receivedAt: 'desc' },
              select: {
                  from: true,
                  participant: true,
                  pushName: true,
                  contact: {
                      select: { firstName: true, lastName: true, phone: true },
                  },
                  editSecret: {
                      select: { senderJid: true, senderAltJid: true },
                  },
              },
          })
        : [];
    const identityByKey = new Map<string, (typeof identities)[number]>();
    for (const identity of identities) {
        for (const jid of identityJids(identity)) {
            const jidKey = jid.toLowerCase();
            const phoneKey = normalizeReactionPhone(jid);
            if (!identityByKey.has(jidKey)) identityByKey.set(jidKey, identity);
            if (phoneKey && !identityByKey.has(phoneKey)) identityByKey.set(phoneKey, identity);
        }
    }

    const identityPhones = identities
        .flatMap(identity => identityJids(identity).map(normalizeReactionPhone))
        .filter(Boolean);
    const contactPhones = [...new Set([...lookupPhones, ...identityPhones])];
    const contactCandidates = [
        ...new Set(contactPhones.flatMap(phone => [phone, `+${phone}`])),
    ];
    const contacts = contactCandidates.length > 0
        ? await prisma.contact.findMany({
              where: {
                  phone: { in: contactCandidates },
                  contactDevices: { some: { deviceId } },
              },
              select: { firstName: true, lastName: true, phone: true },
          })
        : [];
    const contactByPhone = new Map(
        contacts.map(contact => [normalizeReactionPhone(contact.phone), contact]),
    );
    const device = await prisma.device.findUnique({
        where: { pkId: deviceId },
        select: { id: true, phone: true },
    });
    const ownPhone = normalizeReactionPhone(device?.phone);
    const profilePhones = [...new Set([...contactPhones, ownPhone].filter(Boolean))];
    const profileJids = profilePhones.map(phone => `${phone}@s.whatsapp.net`);
    const profileSummaries = await getInboxProfileCacheSummaries(deviceId, profileJids);
    const profileForPhone = (phone: string) => {
        const profileJid = phone ? `${phone}@s.whatsapp.net` : '';
        const summary = profileJid ? profileSummaries.get(profileJid) : undefined;
        return {
            profilePicUrl: device?.id && profileJid
                ? createInboxProfileUrl(device.id, profileJid)
                : null,
            profileStatus: summary?.status
                || (profileJid ? 'pending' : 'unavailable'),
        } as const;
    };

    return decryptedVotes.map(vote => {
        if (!vote.encryptedVoterJid && !vote.isOwnVote) return { ...vote, voter: null };
        if (vote.isOwnVote) {
            return {
                ...vote,
                voter: {
                    name: 'Anda',
                    phone: null,
                    ...profileForPhone(ownPhone),
                    votedAt: vote.votedAt.toISOString(),
                    isMe: true,
                },
            };
        }

        const directPhone = normalizeReactionPhone(vote.voterJid);
        const identity = identityByKey.get(vote.voterJid.toLowerCase())
            || (directPhone ? identityByKey.get(directPhone) : undefined);
        const identityPhone = identity
            ? identityJids(identity).map(normalizeReactionPhone).find(Boolean) || ''
            : '';
        const phone = directPhone
            || identityPhone
            || normalizeReactionPhone(identity?.contact?.phone)
            || '';
        const contact = (phone ? contactByPhone.get(phone) : undefined) || identity?.contact;
        const name = contactName(contact)
            || vote.storedName
            || String(identity?.pushName || '').trim()
            || (phone ? `+${phone}` : 'Tidak dikenal');

        return {
            ...vote,
            voter: {
                name,
                phone: phone ? `+${phone}` : null,
                ...profileForPhone(phone),
                votedAt: vote.votedAt.toISOString(),
                isMe: false,
            },
        };
    });
};

const serializePollState = async (
    deviceId: number,
    poll: PollStateRecord,
): Promise<InboxPollState | null> => {
    const definition = parseDefinition(poll.encryptedDefinition);
    if (!definition) return null;

    const counts = new Map(definition.options.map(option => [option.id, 0]));
    const votersByOption = new Map(
        definition.options.map(option => [option.id, [] as PollVoterState[]]),
    );
    const resolvedVotes = await resolvePollVoters(deviceId, poll.votes);
    for (const vote of resolvedVotes) {
        for (const selectedId of selectedIds(vote.selectedOptionIds)) {
            if (counts.has(selectedId)) {
                counts.set(selectedId, Number(counts.get(selectedId) || 0) + 1);
                if (vote.voter) votersByOption.get(selectedId)?.push(vote.voter);
            }
        }
    }
    const ownVote = resolvedVotes.find(vote => vote.isOwnVote);

    return {
        ...definition,
        options: definition.options.map(option => ({
            ...option,
            voteCount: Number(counts.get(option.id) || 0),
            voters: votersByOption.get(option.id) || [],
        })),
        totalVotes: poll.votes.filter(vote => selectedIds(vote.selectedOptionIds).length > 0).length,
        mySelectedOptionIds: ownVote ? selectedIds(ownVote.selectedOptionIds) : [],
        updatedAt: poll.updatedAt.toISOString(),
    };
};

export const saveMessagePoll = async (input: {
    deviceId: number;
    sessionId: string;
    conversationJid: string;
    targetMessageId: string;
    targetFromMe: boolean;
    ownJid?: string | null;
    ownLid?: string | null;
    key: WAMessageKey;
    content: MessageContent;
}): Promise<InboxPollState | null> => {
    const definition = extractMessagePollDefinition(input.content);
    if (!definition) return null;

    const secret = findPollSecret(input.content);
    const creatorJid = messagePollCreatorJid({
        key: input.key,
        ownJid: input.ownJid,
        ownLid: input.ownLid,
    }) || normalizeIdentityJid(
        getKeyAuthor(input.key, input.ownJid || 'me') || input.conversationJid,
    );
    const poll = await prisma.messagePoll.upsert({
        where: {
            deviceId_targetMessageId: {
                deviceId: input.deviceId,
                targetMessageId: input.targetMessageId,
            },
        },
        create: {
            deviceId: input.deviceId,
            sessionId: input.sessionId,
            conversationJid: input.conversationJid,
            targetMessageId: input.targetMessageId,
            targetFromMe: input.targetFromMe,
            creatorJid,
            encryptedDefinition: encrypt(JSON.stringify(definition)),
            encryptedSecret: secret
                ? encrypt(Buffer.from(secret).toString('base64'))
                : null,
        },
        update: {
            conversationJid: input.conversationJid,
            targetFromMe: input.targetFromMe,
            creatorJid,
            encryptedDefinition: encrypt(JSON.stringify(definition)),
            ...(secret
                ? { encryptedSecret: encrypt(Buffer.from(secret).toString('base64')) }
                : {}),
        },
        include: { votes: true },
    });
    return serializePollState(input.deviceId, poll);
};

const pollUpdateTimestamp = (value: unknown) => {
    const numeric = typeof value === 'object' && value && 'toNumber' in value
        ? Number((value as { toNumber: () => number }).toNumber())
        : Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return new Date();
    return new Date(numeric < 1_000_000_000_000 ? numeric * 1000 : numeric);
};

export const applyMessagePollUpdate = async (input: {
    deviceId: number;
    sessionId: string;
    session?: WASocket | null;
    ownJid?: string | null;
    ownLid?: string | null;
    voterDisplayName?: string | null;
    key: WAMessageKey;
    content: MessageContent;
}): Promise<{
    handled: boolean;
    targetMessageId?: string;
    conversationJid?: string;
    targetFromMe?: boolean;
    pollData?: InboxPollState | null;
}> => {
    const update = input.content?.pollUpdateMessage;
    const targetMessageId = String(update?.pollCreationMessageKey?.id || '');
    if (!targetMessageId) return { handled: false };

    const poll = await prisma.messagePoll.findFirst({
        where: {
            deviceId: input.deviceId,
            targetMessageId,
            sessionId: input.sessionId,
        },
    });
    if (!poll?.encryptedSecret || !update?.vote) {
        return {
            handled: true,
            targetMessageId,
            conversationJid: poll?.conversationJid,
            targetFromMe: poll?.targetFromMe,
            pollData: null,
        };
    }

    const pollSecret = Buffer.from(decrypt(poll.encryptedSecret), 'base64');
    const pollCreatorJids = await resolvePollCreatorJids({
        deviceId: input.deviceId,
        targetMessageId: poll.targetMessageId,
        targetFromMe: poll.targetFromMe,
        storedCreatorJid: poll.creatorJid,
        creationKey: update.pollCreationMessageKey as WAMessageKey,
        session: input.session,
        ownJid: input.ownJid,
        ownLid: input.ownLid,
    });
    const voterJids = await resolvePollVoterJids(
        input.key,
        input.session,
        input.ownJid,
        input.ownLid,
    );
    let vote: proto.Message.PollVoteMessage | null = null;
    let decryptedCreatorJid = '';
    let decryptedVoterJid = '';
    for (const pollCreatorJid of pollCreatorJids) {
        for (const voterJid of voterJids) {
            try {
                vote = decryptPollVote(update.vote, {
                    pollCreatorJid,
                    pollMsgId: poll.targetMessageId,
                    pollEncKey: pollSecret,
                    voterJid,
                });
                decryptedCreatorJid = pollCreatorJid;
                decryptedVoterJid = voterJid;
                break;
            } catch {
                // WhatsApp may address the creator by LID and the voter by PN.
            }
        }
        if (vote) break;
    }
    if (!vote || !decryptedVoterJid) {
        throw createPollServiceError(
            'Identitas vote polling WhatsApp tidak dapat diverifikasi',
            409,
            'POLL_VOTE_DECRYPT_FAILED',
        );
    }
    const optionIds = (vote.selectedOptions || []).map((value: Uint8Array) =>
        Buffer.from(value).toString('base64')
    );
    const voterJid = voterJids.find(jid => jid.endsWith('@s.whatsapp.net'))
        || decryptedVoterJid;
    refreshPollVoterProfile(input.deviceId, voterJid, input.session);
    const voterHash = createHash('sha256')
        .update(String(voterJid || 'unknown').trim().toLowerCase())
        .digest('hex');
    const votedAt = pollUpdateTimestamp(update.senderTimestampMs);
    const encryptedVoterJid = voterJid ? encrypt(voterJid) : null;
    const encryptedVoterName = input.voterDisplayName?.trim()
        ? encrypt(input.voterDisplayName.trim())
        : null;
    const isOwnVote = Boolean(input.key.fromMe);

    await prisma.$transaction(async tx => {
        if (optionIds.length === 0) {
            await tx.messagePollVote.deleteMany({
                where: { pollId: poll.pkId, voterHash },
            });
        } else {
            await tx.messagePollVote.upsert({
                where: { pollId_voterHash: { pollId: poll.pkId, voterHash } },
                create: {
                    pollId: poll.pkId,
                    voterHash,
                    encryptedVoterJid,
                    encryptedVoterName,
                    isOwnVote,
                    selectedOptionIds: optionIds,
                    votedAt,
                },
                update: {
                    encryptedVoterJid,
                    encryptedVoterName,
                    isOwnVote,
                    selectedOptionIds: optionIds,
                    votedAt,
                },
            });
        }
        await tx.messagePoll.update({
            where: { pkId: poll.pkId },
            data: {
                creatorJid: decryptedCreatorJid || poll.creatorJid,
                updatedAt: new Date(),
            },
        });
    });

    const updated = await prisma.messagePoll.findUnique({
        where: { pkId: poll.pkId },
        include: { votes: true },
    });
    const pollData = updated ? await serializePollState(input.deviceId, updated) : null;
    return {
        handled: true,
        targetMessageId,
        conversationJid: poll.conversationJid,
        targetFromMe: poll.targetFromMe,
        pollData,
    };
};

const createPollServiceError = (message: string, statusCode: number, code: string) => {
    const error = new Error(message) as Error & { statusCode: number; code: string };
    error.statusCode = statusCode;
    error.code = code;
    return error;
};

export const encryptMessagePollVote = (input: {
    pollMessageId: string;
    pollCreatorJid: string;
    pollSecret: Buffer;
    voterJid: string;
    selectedOptionIds: string[];
}) => {
    const encodedVote = proto.Message.PollVoteMessage.encode({
        selectedOptions: input.selectedOptionIds.map(id => Buffer.from(id, 'base64')),
    }).finish();
    const signature = Buffer.concat([
        Buffer.from(input.pollMessageId),
        Buffer.from(input.pollCreatorJid),
        Buffer.from(input.voterJid),
        Buffer.from('Poll Vote'),
        Buffer.from([1]),
    ]);
    const key0 = createHmac('sha256', Buffer.alloc(32))
        .update(input.pollSecret)
        .digest();
    const encryptionKey = createHmac('sha256', key0).update(signature).digest();
    const additionalData = Buffer.from(`${input.pollMessageId}\u0000${input.voterJid}`);
    const encIv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', encryptionKey, encIv);
    cipher.setAAD(additionalData);
    const encPayload = Buffer.concat([
        cipher.update(encodedVote),
        cipher.final(),
        cipher.getAuthTag(),
    ]);
    return { encPayload, encIv };
};

export const sendMessagePollVote = async (input: {
    deviceId: number;
    sessionId: string;
    session: WASocket;
    targetMessageId: string;
    selectedOptionIds: string[];
    reactionMessageId: string;
}): Promise<{
    targetMessageId: string;
    targetFromMe: boolean;
    conversationJid: string;
    pollData: InboxPollState;
}> => {
    const poll = await prisma.messagePoll.findFirst({
        where: {
            deviceId: input.deviceId,
            sessionId: input.sessionId,
            targetMessageId: input.targetMessageId,
        },
        include: { votes: true },
    });
    if (!poll) {
        throw createPollServiceError('Polling tidak ditemukan', 404, 'POLL_NOT_FOUND');
    }
    const definition = parseDefinition(poll.encryptedDefinition);
    if (!definition) {
        throw createPollServiceError('Data polling tidak valid', 409, 'POLL_INVALID');
    }
    if (!poll.encryptedSecret) {
        throw createPollServiceError(
            'Kunci polling belum tersedia. Muat ulang percakapan dan coba kembali.',
            409,
            'POLL_SECRET_UNAVAILABLE',
        );
    }

    const validOptionIds = new Set(definition.options.map(option => option.id));
    const selectedOptionIds = [...new Set(input.selectedOptionIds.filter(Boolean))];
    if (selectedOptionIds.some(id => !validOptionIds.has(id))) {
        throw new MessagePollValidationError('Pilihan polling tidak valid');
    }
    if (selectedOptionIds.length > definition.selectableOptionsCount) {
        throw new MessagePollValidationError(
            `Polling ini hanya mengizinkan ${definition.selectableOptionsCount} pilihan`,
        );
    }

    const socketUser = input.session.user as PollSocketUser | undefined;
    const ownJids = await expandIdentityJids(
        input.session,
        [socketUser?.id, socketUser?.lid],
        '@s.whatsapp.net',
    );
    const ownPnJid = ownJids.find(jid => jid.endsWith('@s.whatsapp.net')) || '';
    const ownLidJid = ownJids.find(jid => jid.endsWith('@lid')) || '';
    if (!ownPnJid && !ownLidJid) {
        throw createPollServiceError('Device WhatsApp belum terhubung', 409, 'DEVICE_OFFLINE');
    }
    const pollSecret = Buffer.from(decrypt(poll.encryptedSecret), 'base64');
    const pollCreatorJids = await resolvePollCreatorJids({
        deviceId: input.deviceId,
        targetMessageId: poll.targetMessageId,
        targetFromMe: poll.targetFromMe,
        storedCreatorJid: poll.creatorJid,
        session: input.session,
        ownJid: socketUser?.id,
        ownLid: socketUser?.lid,
    });
    const pollCreatorJid = pollCreatorJids.find(jid => jid.endsWith('@lid'))
        || pollCreatorJids[0]
        || '';
    if (!pollCreatorJid) {
        throw createPollServiceError(
            'Identitas pembuat polling belum tersedia. Muat ulang percakapan lalu coba lagi.',
            409,
            'POLL_CREATOR_UNAVAILABLE',
        );
    }
    // WhatsApp group polls that use LID addressing also encrypt the vote with
    // the voter's LID. Personal chats and PN-addressed groups use the PN JID.
    const userJid = messagePollVoterJid({
        conversationJid: poll.conversationJid,
        pollCreatorJid,
        ownPnJid,
        ownLidJid,
    });
    const vote = encryptMessagePollVote({
        pollMessageId: poll.targetMessageId,
        pollCreatorJid,
        pollSecret,
        voterJid: userJid,
        selectedOptionIds,
    });
    const targetKey = messagePollCreationKey({
        conversationJid: poll.conversationJid,
        targetMessageId: poll.targetMessageId,
        targetFromMe: poll.targetFromMe,
        pollCreatorJid,
    });
    const delivery = waitForPollVoteDelivery(input.reactionMessageId);
    try {
        await input.session.relayMessage(
            poll.conversationJid,
            {
                pollUpdateMessage: {
                    pollCreationMessageKey: targetKey,
                    vote,
                    senderTimestampMs: Date.now(),
                },
            },
            {
                messageId: input.reactionMessageId,
                additionalNodes: [{
                    tag: 'meta',
                    attrs: {
                        polltype: 'vote',
                        'decrypt-fail': 'hide',
                    },
                }],
            },
        );
    } catch (error) {
        delivery.cancel();
        throw error;
    }
    const failureCode = await delivery.result;
    if (failureCode) {
        throw createPollServiceError(
            failureCode === '479'
                ? 'Vote ditolak oleh WhatsApp karena format/alamat polling tidak valid. Muat ulang percakapan lalu coba lagi.'
                : 'Vote ditolak oleh server WhatsApp. Silakan coba lagi.',
            409,
            'POLL_VOTE_REJECTED',
        );
    }

    const storedVoterJid = ownPnJid || userJid;
    refreshPollVoterProfile(input.deviceId, storedVoterJid, input.session);
    const voterHash = createHash('sha256').update(storedVoterJid.toLowerCase()).digest('hex');
    const votedAt = new Date();
    await prisma.$transaction(async tx => {
        if (selectedOptionIds.length === 0) {
            await tx.messagePollVote.deleteMany({
                where: { pollId: poll.pkId, voterHash },
            });
        } else {
            await tx.messagePollVote.upsert({
                where: { pollId_voterHash: { pollId: poll.pkId, voterHash } },
                create: {
                    pollId: poll.pkId,
                    voterHash,
                    encryptedVoterJid: encrypt(storedVoterJid),
                    encryptedVoterName: encrypt('Anda'),
                    isOwnVote: true,
                    selectedOptionIds,
                    votedAt,
                },
                update: {
                    encryptedVoterJid: encrypt(storedVoterJid),
                    encryptedVoterName: encrypt('Anda'),
                    isOwnVote: true,
                    selectedOptionIds,
                    votedAt,
                },
            });
        }
        await tx.messagePoll.update({
            where: { pkId: poll.pkId },
            data: { creatorJid: pollCreatorJid, updatedAt: votedAt },
        });
    });

    const updated = await prisma.messagePoll.findUnique({
        where: { pkId: poll.pkId },
        include: { votes: true },
    });
    const pollData = updated ? await serializePollState(input.deviceId, updated) : null;
    if (!pollData) {
        throw createPollServiceError('Hasil polling tidak tersedia', 500, 'POLL_STATE_MISSING');
    }
    return {
        targetMessageId: poll.targetMessageId,
        targetFromMe: poll.targetFromMe,
        conversationJid: poll.conversationJid,
        pollData,
    };
};

export const getMessagePollStates = async (
    deviceId: number,
    messageIds: string[],
): Promise<Map<string, InboxPollState>> => {
    if (messageIds.length === 0) return new Map();
    const polls = await prisma.messagePoll.findMany({
        where: {
            deviceId,
            targetMessageId: { in: [...new Set(messageIds.filter(Boolean))] },
        },
        include: { votes: true },
    });
    const states = new Map<string, InboxPollState>();
    for (const poll of polls) {
        const state = await serializePollState(deviceId, poll);
        if (state) states.set(poll.targetMessageId, state);
    }
    return states;
};

export const deleteMessagePolls = (deviceId: number, messageIds: string[]) => {
    if (messageIds.length === 0) return Promise.resolve({ count: 0 });
    return prisma.messagePoll.deleteMany({
        where: { deviceId, targetMessageId: { in: messageIds } },
    });
};

export const deleteConversationPolls = (deviceId: number, conversationJid: string) =>
    prisma.messagePoll.deleteMany({ where: { deviceId, conversationJid } });

export const deleteAllDevicePolls = (deviceId: number) =>
    prisma.messagePoll.deleteMany({ where: { deviceId } });
