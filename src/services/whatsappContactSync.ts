import logger from '../config/logger';
import { getConnectedDeviceInstance } from '../whatsapp';

export type WhatsAppContactSyncStatus = 'synced' | 'device_offline' | 'failed';

export type WhatsAppContactSyncResult = {
    requested: true;
    synced: boolean;
    status: WhatsAppContactSyncStatus;
};

type SyncWhatsAppContactInput = {
    devicePkId: number;
    phone: string;
    firstName: string;
    lastName?: string | null;
};

export const buildWhatsAppContactMutation = (
    input: Omit<SyncWhatsAppContactInput, 'devicePkId'>,
) => {
    const firstName = String(input.firstName || '').trim();
    const lastName = String(input.lastName || '').trim();
    const fullName = [firstName, lastName].filter(Boolean).join(' ');
    const normalizedPhone = String(input.phone || '').replace(/\D/g, '');
    if (!normalizedPhone || !firstName) return null;

    return {
        jid: `${normalizedPhone}@s.whatsapp.net`,
        contact: {
            firstName,
            fullName,
            saveOnPrimaryAddressbook: false,
        },
    };
};

const CONTACT_SYNC_TIMEOUT_MS = 15_000;

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number): Promise<T> => {
    let timeout: NodeJS.Timeout | undefined;
    try {
        return await Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timeout = setTimeout(
                    () => reject(new Error('WhatsApp contact sync timed out')),
                    timeoutMs,
                );
            }),
        ]);
    } finally {
        if (timeout) clearTimeout(timeout);
    }
};

/**
 * Save a contact to WhatsApp's encrypted contact app-state without asking the
 * primary phone to add it to Google Contacts, iCloud, SIM, or the phone book.
 */
export const syncContactToWhatsApp = async (
    input: SyncWhatsAppContactInput,
): Promise<WhatsAppContactSyncResult> => {
    const connected = getConnectedDeviceInstance(input.devicePkId);
    if (!connected) {
        return { requested: true, synced: false, status: 'device_offline' };
    }

    const mutation = buildWhatsAppContactMutation(input);
    if (!mutation) {
        return { requested: true, synced: false, status: 'failed' };
    }

    try {
        await withTimeout(
            connected.session.addOrEditContact(mutation.jid, mutation.contact),
            CONTACT_SYNC_TIMEOUT_MS,
        );
        return { requested: true, synced: true, status: 'synced' };
    } catch (error) {
        logger.warn(
            {
                devicePkId: input.devicePkId,
                code: (error as { code?: unknown })?.code,
            },
            'Failed to sync contact to WhatsApp encrypted contact storage',
        );
        return { requested: true, synced: false, status: 'failed' };
    }
};
