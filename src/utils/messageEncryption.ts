/**
 * ============================================
 * 🔐 MESSAGE ENCRYPTION UTILITY
 * ============================================
 * 
 * Utility untuk enkripsi/dekripsi konten pesan di database.
 * Menggunakan infrastruktur AES-256-GCM yang sudah ada di encryption.ts
 * 
 * Field yang dienkripsi:
 * - OutgoingMessage.message
 * - IncomingMessage.content
 * - Broadcast.message
 * - Message.message (raw Baileys JSON)
 * 
 * ============================================
 */

import crypto from 'crypto';
import { decrypt as decryptLegacy, isEncrypted as isLegacyEncrypted } from './encryption';
import logger from '../config/logger';

const MESSAGE_ALGORITHM = 'aes-256-gcm';
const MESSAGE_IV_LENGTH = 16;
const MESSAGE_AUTH_TAG_LENGTH = 16;
const MESSAGE_ENCRYPTED_PREFIX = 'enc:msg:v2:';
const DEFAULT_MESSAGE_KEY_ID = 'primary';

type MessageKeyConfig = { id: string; key: Buffer };

function parseMessageKey(value: string | undefined, label: string): Buffer | null {
    const raw = String(value || '').trim();
    if (!raw) return null;

    let key: Buffer;
    if (/^[0-9a-fA-F]{64}$/.test(raw)) {
        key = Buffer.from(raw, 'hex');
    } else {
        try {
            key = Buffer.from(raw, 'base64');
        } catch {
            throw new Error(`${label} must be a 32-byte hex or base64 key`);
        }
    }

    if (key.length !== 32) {
        throw new Error(`${label} must decode to exactly 32 bytes`);
    }
    return key;
}

function getActiveMessageKey(): MessageKeyConfig | null {
    const key = parseMessageKey(process.env.MESSAGE_ENCRYPTION_KEY, 'MESSAGE_ENCRYPTION_KEY');
    if (!key) {
        // Keep local/test environments encrypted during rollout without weakening
        // the production requirement for an independently managed message key.
        if (process.env.NODE_ENV !== 'production') {
            const derived = getDerivedLocalMessageKey();
            if (derived) return { id: 'derived-local', key: derived };
        }
        return null;
    }

    const id = String(process.env.MESSAGE_ENCRYPTION_KEY_ID || DEFAULT_MESSAGE_KEY_ID).trim();
    if (!/^[A-Za-z0-9_-]{1,32}$/.test(id)) {
        throw new Error('MESSAGE_ENCRYPTION_KEY_ID must contain only letters, numbers, _ or -');
    }
    return { id, key };
}

function getDerivedLocalMessageKey(): Buffer | null {
    const sessionKey = parseMessageKey(
        process.env.SESSION_ENCRYPTION_KEY,
        'SESSION_ENCRYPTION_KEY',
    );
    if (!sessionKey) return null;
    return Buffer.from(
        crypto.hkdfSync(
            'sha256',
            sessionKey,
            Buffer.alloc(0),
            Buffer.from('autosender-message-encryption-v2'),
            32,
        ),
    );
}

function getPreviousMessageKeys(): Map<string, Buffer> {
    const keys = new Map<string, Buffer>();
    const raw = String(process.env.MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON || '').trim();
    if (!raw) return keys;

    let parsed: unknown;
    try {
        parsed = JSON.parse(raw);
    } catch {
        throw new Error('MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON must be valid JSON');
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON must be a key-value object');
    }

    Object.entries(parsed as Record<string, unknown>).forEach(([id, value]) => {
        if (!/^[A-Za-z0-9_-]{1,32}$/.test(id) || typeof value !== 'string') {
            throw new Error('Previous message encryption key entry is invalid');
        }
        const key = parseMessageKey(value, `Previous message key ${id}`);
        if (key) keys.set(id, key);
    });
    return keys;
}

function getMessageKey(keyId: string): Buffer | null {
    const active = getActiveMessageKey();
    if (active?.id === keyId) return active.key;
    if (keyId === 'derived-local') return getDerivedLocalMessageKey();
    return getPreviousMessageKeys().get(keyId) || null;
}

function isCurrentMessageCiphertext(message: string): boolean {
    return message.startsWith(MESSAGE_ENCRYPTED_PREFIX);
}

// ============================================
// SINGLE MESSAGE ENCRYPTION
// ============================================

/**
 * Encrypt message content before saving to database
 * Returns original text if encryption is disabled
 * 
 * Overloads:
 * - If input is string, returns string
 * - If input is null/undefined, returns null
 */
export function encryptMessage(message: string): string;
export function encryptMessage(message: null | undefined): null;
export function encryptMessage(message: string | null | undefined): string | null;
export function encryptMessage(message: string | null | undefined): string | null {
    if (!message) return null;

    if (isCurrentMessageCiphertext(message) || isLegacyEncrypted(message)) {
        return message;
    }

    if (!isMessageEncryptionEnabled()) {
        if (process.env.NODE_ENV === 'production') {
            throw new Error('Message encryption is required in production');
        }
        return message;
    }

    const active = getActiveMessageKey();
    if (!active) {
        throw new Error('MESSAGE_ENCRYPTION_KEY is required when message encryption is enabled');
    }

    try {
        const iv = crypto.randomBytes(MESSAGE_IV_LENGTH);
        const cipher = crypto.createCipheriv(
            MESSAGE_ALGORITHM,
            active.key as unknown as crypto.CipherKey,
            iv as unknown as crypto.BinaryLike,
        ) as crypto.CipherGCM;
        cipher.setAAD(Buffer.from(active.id, 'utf8'));
        let encrypted = cipher.update(message, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        const authTag = cipher.getAuthTag();
        return `${MESSAGE_ENCRYPTED_PREFIX}${active.id}:${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
        logger.error({ error }, '[MessageEncryption] Failed to encrypt message');
        throw new Error('Failed to encrypt message content');
    }
}

/**
 * Decrypt message content when reading from database
 * Handles legacy (unencrypted) data gracefully
 * 
 * Overloads:
 * - If input is string, returns string
 * - If input is null/undefined, returns null
 */
export function decryptMessage(message: string): string;
export function decryptMessage(message: null | undefined): null;
export function decryptMessage(message: string | null | undefined): string | null;
export function decryptMessage(message: string | null | undefined): string | null {
    if (!message) return null;

    if (isCurrentMessageCiphertext(message)) {
        try {
            const parts = message.slice(MESSAGE_ENCRYPTED_PREFIX.length).split(':');
            if (parts.length !== 4) throw new Error('Invalid encrypted message format');

            const [keyId, ivHex, authTagHex, encryptedHex] = parts;
            const key = getMessageKey(keyId);
            if (!key) throw new Error(`Message encryption key ${keyId} is not available`);

            const iv = Buffer.from(ivHex, 'hex');
            const authTag = Buffer.from(authTagHex, 'hex');
            if (iv.length !== MESSAGE_IV_LENGTH || authTag.length !== MESSAGE_AUTH_TAG_LENGTH) {
                throw new Error('Invalid encrypted message metadata');
            }

            const decipher = crypto.createDecipheriv(
                MESSAGE_ALGORITHM,
                key as unknown as crypto.CipherKey,
                iv as unknown as crypto.BinaryLike,
            ) as crypto.DecipherGCM;
            decipher.setAAD(Buffer.from(keyId, 'utf8'));
            decipher.setAuthTag(authTag as unknown as NodeJS.ArrayBufferView);
            let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
            decrypted += decipher.final('utf8');
            return decrypted;
        } catch (error) {
            logger.error({ error }, '[MessageEncryption] Failed to decrypt message');
            throw new Error('Failed to decrypt message content');
        }
    }

    // Existing enc:v1 rows remain readable with SESSION_ENCRYPTION_KEY.
    if (isLegacyEncrypted(message)) return decryptLegacy(message);

    // Plaintext rows are supported only for legacy reads and migration.
    return message;
}

// ============================================
// BATCH OPERATIONS FOR QUERY RESULTS
// ============================================

/**
 * Decrypt message field in an OutgoingMessage object
 */
export function decryptOutgoingMessage<T extends { message?: string | null }>(
    record: T
): T {
    if (!record || !record.message) return record;
    
    return {
        ...record,
        message: decryptMessage(record.message),
    };
}

/**
 * Decrypt content field in an IncomingMessage object
 * Note: IncomingMessage uses 'message' field, not 'content'
 */
export function decryptIncomingMessage<T extends { message?: string | null }>(
    record: T
): T {
    if (!record || !record.message) return record;
    
    return {
        ...record,
        message: decryptMessage(record.message),
    };
}

/**
 * Decrypt message field in a Broadcast object
 */
export function decryptBroadcast<T extends { message?: string | null }>(
    record: T
): T {
    if (!record || !record.message) return record;
    
    return {
        ...record,
        message: decryptMessage(record.message),
    };
}

/**
 * Decrypt an array of OutgoingMessage records
 */
export function decryptOutgoingMessages<T extends { message?: string | null }>(
    records: T[]
): T[] {
    return records.map(decryptOutgoingMessage);
}

/**
 * Decrypt an array of IncomingMessage records
 */
export function decryptIncomingMessages<T extends { message?: string | null }>(
    records: T[]
): T[] {
    return records.map(decryptIncomingMessage);
}

/**
 * Decrypt an array of Broadcast records
 */
export function decryptBroadcasts<T extends { message?: string | null }>(
    records: T[]
): T[] {
    return records.map(decryptBroadcast);
}

// ============================================
// JSON MESSAGE ENCRYPTION (for Baileys raw messages)
// ============================================

/**
 * Encrypt JSON message object (for Message.message field)
 */
export function encryptJsonMessage(messageJson: object | null | undefined): string | null {
    if (!messageJson) return null;
    
    const jsonString = typeof messageJson === 'string' 
        ? messageJson 
        : JSON.stringify(messageJson);
    
    return encryptMessage(jsonString);
}

/**
 * Decrypt JSON message object
 */
export function decryptJsonMessage(encryptedJson: string | null | undefined): object | null {
    if (!encryptedJson) return null;
    
    const decrypted = decryptMessage(encryptedJson);
    if (!decrypted) return null;
    
    try {
        return JSON.parse(decrypted);
    } catch {
        // Already an object or invalid JSON
        return decrypted as unknown as object;
    }
}

// ============================================
// UTILITY FUNCTIONS
// ============================================

/**
 * Check if message encryption is enabled
 */
export function isMessageEncryptionEnabled(): boolean {
    const explicit = process.env.MESSAGE_ENCRYPTION_ENABLED;
    if (explicit !== undefined) return explicit.toLowerCase() === 'true';
    return Boolean(
        String(process.env.MESSAGE_ENCRYPTION_KEY || '').trim() ||
            (process.env.NODE_ENV !== 'production' &&
                String(process.env.SESSION_ENCRYPTION_KEY || '').trim()),
    );
}

/**
 * Check if a message is encrypted
 */
export function isMessageEncrypted(message: string | null | undefined): boolean {
    if (!message) return false;
    return isCurrentMessageCiphertext(message) || isLegacyEncrypted(message);
}

export function isCurrentMessageEncrypted(message: string | null | undefined): boolean {
    return Boolean(message && isCurrentMessageCiphertext(message));
}

export function validateMessageEncryptionSetup(): { valid: boolean; message: string } {
    const enabled = isMessageEncryptionEnabled();
    if (!enabled) {
        return process.env.NODE_ENV === 'production'
            ? { valid: false, message: 'Message encryption must be enabled in production' }
            : { valid: true, message: 'Message encryption is disabled outside production' };
    }

    try {
        const active = getActiveMessageKey();
        if (!active) {
            return { valid: false, message: 'MESSAGE_ENCRYPTION_KEY is missing' };
        }
        if (
            process.env.NODE_ENV === 'production' &&
            !String(process.env.MESSAGE_ENCRYPTION_KEY || '').trim()
        ) {
            return {
                valid: false,
                message: 'A dedicated MESSAGE_ENCRYPTION_KEY is required in production',
            };
        }
        getPreviousMessageKeys();
        const sample = `message-encryption-self-test-${Date.now()}`;
        const encrypted = encryptMessage(sample);
        if (!encrypted || decryptMessage(encrypted) !== sample) {
            return { valid: false, message: 'Message encryption self-test failed' };
        }
        return {
            valid: true,
            message: `Message encryption is enabled with key ID ${active.id}`,
        };
    } catch (error) {
        return {
            valid: false,
            message: `Message encryption setup is invalid: ${error instanceof Error ? error.message : String(error)}`,
        };
    }
}

/**
 * Get encryption status info for debugging/monitoring
 */
export function getEncryptionStatus(): {
    enabled: boolean;
    description: string;
} {
    const enabled = isMessageEncryptionEnabled();
    return {
        enabled,
        description: enabled 
            ? 'Message encryption is ENABLED - messages will be encrypted at rest'
            : 'Message encryption is DISABLED - messages stored in plaintext',
    };
}
