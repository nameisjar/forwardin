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

import { encrypt, decrypt, isEncrypted, isEncryptionEnabled } from './encryption';
import logger from '../config/logger';

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
    
    if (!isEncryptionEnabled()) {
        return message;
    }

    // Don't double-encrypt
    if (isEncrypted(message)) {
        return message;
    }

    try {
        return encrypt(message);
    } catch (error) {
        logger.error({ error }, '[MessageEncryption] Failed to encrypt message');
        return message; // Fallback to plaintext
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

    // If not encrypted, return as-is (legacy data)
    if (!isEncrypted(message)) {
        return message;
    }

    try {
        return decrypt(message);
    } catch (error) {
        logger.error({ error }, '[MessageEncryption] Failed to decrypt message');
        throw new Error('Failed to decrypt message content');
    }
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
    return isEncryptionEnabled();
}

/**
 * Check if a message is encrypted
 */
export function isMessageEncrypted(message: string | null | undefined): boolean {
    if (!message) return false;
    return isEncrypted(message);
}

/**
 * Get encryption status info for debugging/monitoring
 */
export function getEncryptionStatus(): {
    enabled: boolean;
    description: string;
} {
    const enabled = isEncryptionEnabled();
    return {
        enabled,
        description: enabled 
            ? 'Message encryption is ENABLED - messages will be encrypted at rest'
            : 'Message encryption is DISABLED - messages stored in plaintext',
    };
}
