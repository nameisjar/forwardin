/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from './db';
import { generateSlug } from './slug';

export type NormalizedBroadcastRecipient = {
    jid: string;
    type: 'number' | 'group';
};

export type StoredWhatsAppGroup = {
    groupId: string;
    groupName: string;
    isActive: boolean;
    sessionId: string | null;
    updatedAt?: Date;
};

// WhatsApp currently uses both modern numeric group IDs (120363...@g.us)
// and legacy creator/timestamp IDs (12345-67890@g.us). Keep this stricter
// than Baileys' suffix-only isJidGroup check so malformed stored recipients
// are still rejected before a send is attempted.
const GROUP_JID_LOCAL_PART_PATTERN = /^\d{10,30}(?:-\d{5,20})?$/;

function isValidGroupJidLocalPart(value: string): boolean {
    return GROUP_JID_LOCAL_PART_PATTERN.test(value);
}

function normalizePersonalNumber(value: string): string {
    if (!/^\+?[\d\s().-]+$/.test(value)) {
        throw new Error('Nomor penerima tidak valid');
    }

    let digits = value.replace(/\D/g, '');
    if (digits.startsWith('00')) digits = digits.slice(2);
    if (digits.startsWith('08')) digits = `62${digits.slice(1)}`;
    else if (digits.startsWith('8')) digits = `62${digits}`;

    if (!/^\d{6,15}$/.test(digits)) {
        throw new Error('Nomor penerima tidak valid');
    }
    return digits;
}

/** Normalize a stored/manual recipient before any WhatsApp lookup or send. */
export function normalizeBroadcastRecipient(recipient: unknown): NormalizedBroadcastRecipient {
    const raw = String(recipient || '').trim();
    if (!raw) throw new Error('Penerima broadcast kosong');

    const atIndex = raw.lastIndexOf('@');
    if (atIndex >= 0) {
        const localPart = raw.slice(0, atIndex).trim();
        const domain = raw
            .slice(atIndex + 1)
            .trim()
            .toLowerCase();

        if (domain === 'g.us') {
            if (!isValidGroupJidLocalPart(localPart)) {
                throw new Error('JID grup tidak valid');
            }
            return { jid: `${localPart}@g.us`, type: 'group' };
        }
        if (domain === 's.whatsapp.net') {
            return {
                jid: `${normalizePersonalNumber(localPart)}@s.whatsapp.net`,
                type: 'number',
            };
        }
        if (domain === 'lid' || domain === 'hosted.lid') {
            if (!/^[^\s@]+$/.test(localPart)) throw new Error('JID LID tidak valid');
            return { jid: `${localPart}@${domain}`, type: 'number' };
        }
        if (domain === 'hosted') {
            return { jid: `${normalizePersonalNumber(localPart)}@hosted`, type: 'number' };
        }
        throw new Error('Domain JID penerima tidak didukung');
    }

    // A suffix-less numeric token is ambiguous with a phone number. Only the
    // unambiguous legacy group form is inferred here; modern group IDs must
    // retain their @g.us suffix when stored.
    if (/^\d{10,30}-\d{5,20}$/.test(raw)) {
        return { jid: `${raw}@g.us`, type: 'group' };
    }

    return {
        jid: `${normalizePersonalNumber(raw)}@s.whatsapp.net`,
        type: 'number',
    };
}

function normalizeGroupJid(value: string): string {
    const raw = String(value || '').trim();
    return raw.toLowerCase().endsWith('@g.us') ? raw : `${raw}@g.us`;
}

/**
 * Rebind a stored group recipient after a QR relink/WhatsApp number change.
 * The replacement is deliberately conservative: it is only used when there
 * is exactly one active group with the same name on the current live session.
 */
export function resolveScheduledGroupRecipient(
    originalJid: string,
    activeSessionId: string,
    groups: StoredWhatsAppGroup[],
): string {
    const normalizedOriginal = normalizeGroupJid(originalJid);
    const originalGroupId = normalizedOriginal.replace(/@g\.us$/i, '');
    const storedGroup = groups.find(
        (group) => String(group.groupId).replace(/@g\.us$/i, '') === originalGroupId,
    );

    if (!storedGroup) return normalizedOriginal;
    if (
        storedGroup.isActive &&
        (!storedGroup.sessionId || storedGroup.sessionId === activeSessionId)
    ) {
        return normalizedOriginal;
    }

    const currentSessionMatches = groups.filter(
        (group) =>
            group.isActive &&
            group.sessionId === activeSessionId &&
            group.groupName === storedGroup.groupName,
    );

    if (currentSessionMatches.length !== 1) return normalizedOriginal;
    return normalizeGroupJid(currentSessionMatches[0].groupId);
}

/** Group metadata lookup happens before send, so it is safe to retry. */
export function getRecipientVerificationFailureStatus(
    normalizedRecipient?: NormalizedBroadcastRecipient,
): 'failed' | 'invalid' {
    return normalizedRecipient?.type === 'group' ? 'failed' : 'invalid';
}

export async function getRecipients(broadcast: any) {
    // get recipients util
    const out = new Set<string>();
    const devId = broadcast.deviceId; // expects Device.pkId (number)

    for (const recipient of broadcast.recipients as string[]) {
        const token = String(recipient || '').trim();
        if (!token) continue;

        // all == all contacts for the device
        if (token === 'all') {
            const contacts = await prisma.contact.findMany({
                where: { contactDevices: { some: { deviceId: devId } } },
                select: { phone: true },
            });
            for (const c of contacts) if (c.phone) out.add(String(c.phone));
            continue;
        }

        // label == contact labels
        if (token.startsWith('label_')) {
            const raw = token.slice('label_'.length);
            const slug = generateSlug(raw);
            const nameEq = raw; // try exact name match as well

            const contacts = await prisma.contact.findMany({
                where: {
                    contactDevices: { some: { deviceId: devId } },
                    ContactLabel: {
                        some: {
                            OR: [{ label: { slug } }, { label: { name: nameEq } }],
                        },
                    },
                },
                select: { phone: true },
            });
            for (const c of contacts) if (c.phone) out.add(String(c.phone));
            continue;
        }

        // group_<name> (legacy) -> expand to group's contacts on this device
        if (token.startsWith('group_')) {
            const groupName = token.slice('group_'.length);
            const group = await prisma.group.findFirst({
                where: {
                    name: groupName,
                    contactGroups: {
                        some: {
                            contact: { contactDevices: { some: { deviceId: devId } } },
                        },
                    },
                },
                include: { contactGroups: { select: { contact: { select: { phone: true } } } } },
            });
            for (const cg of group?.contactGroups || [])
                if (cg.contact?.phone) out.add(String(cg.contact.phone));
            continue;
        }

        // else: assume direct phone or group JID, push as-is (later normalized by sender)
        out.add(token);
    }

    return Array.from(out);
}
