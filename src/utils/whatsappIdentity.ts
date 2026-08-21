type WhatsAppSocketUser = {
    id?: string | null;
    lid?: string | null;
};

/** Return a phone number only for phone-number identities, never for LIDs/groups. */
export function whatsappIdentityPhone(value: string | null | undefined): string {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized || normalized === 'me') return '';
    if (normalized.endsWith('@lid') || normalized.endsWith('@hosted.lid')) return '';
    if (normalized.endsWith('@g.us')) return '';

    const localPart = normalized.split('@')[0].split(':')[0];
    return localPart.replace(/\D/g, '');
}

/** Canonical Inbox key for a WhatsApp phone JID. LIDs and groups stay unresolved. */
export function canonicalPersonalPhoneJid(
    value: string | null | undefined,
): string | null {
    const normalized = String(value || '').trim().toLowerCase();
    if (!normalized) return null;

    const isPhoneAddress = !normalized.includes('@')
        || normalized.endsWith('@s.whatsapp.net');
    if (!isPhoneAddress) return null;

    const phone = whatsappIdentityPhone(normalized);
    return phone ? `${phone}@s.whatsapp.net` : null;
}

export function phoneJidFromMessageKey(value: unknown): string | null {
    if (!value || typeof value !== 'object') return null;
    const key = value as Record<string, unknown>;
    const candidates = [key.remoteJidAlt, key.participantAlt, key.remoteJid, key.participant];
    for (const candidate of candidates) {
        const jid = canonicalPersonalPhoneJid(
            typeof candidate === 'string' ? candidate : null,
        );
        if (jid) return jid;
    }
    return null;
}

/** All known representations of the connected WhatsApp account. */
export function buildOwnWhatsAppIdentityJids(
    devicePhone: string | null | undefined,
    socketUser?: WhatsAppSocketUser | null,
): string[] {
    const values = new Set<string>();
    const add = (value: string | null | undefined) => {
        const normalized = String(value || '').trim().toLowerCase();
        if (normalized) values.add(normalized);
    };

    add(socketUser?.id);
    add(socketUser?.lid);
    add(devicePhone);

    const phoneCandidates = [devicePhone, socketUser?.id]
        .map(whatsappIdentityPhone)
        .filter(Boolean);
    for (const phone of phoneCandidates) {
        add(phone);
        add(`${phone}@s.whatsapp.net`);
    }

    return [...values];
}

export function isOwnWhatsAppIdentity(
    candidate: string | null | undefined,
    ownIdentityJids: readonly string[],
): boolean {
    const normalizedCandidate = String(candidate || '').trim().toLowerCase();
    if (!normalizedCandidate) return false;
    if (normalizedCandidate === 'me') return true;

    const comparableIdentity = (value: string) => {
        const normalized = value.trim().toLowerCase();
        if (normalized.endsWith('@lid') || normalized.endsWith('@hosted.lid')) {
            const [localPart, domain] = normalized.split('@');
            return `${localPart.split(':')[0]}@${domain}`;
        }
        return normalized;
    };

    const normalizedOwn = new Set(
        ownIdentityJids
            .map((value) => comparableIdentity(String(value || '')))
            .filter(Boolean),
    );
    if (normalizedOwn.has(comparableIdentity(normalizedCandidate))) return true;

    const candidatePhone = whatsappIdentityPhone(normalizedCandidate);
    if (!candidatePhone) return false;
    return [...normalizedOwn].some(
        (identity) => whatsappIdentityPhone(identity) === candidatePhone,
    );
}
