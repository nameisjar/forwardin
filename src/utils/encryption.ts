/**
 * ============================================
 * 🔐 ENCRYPTION UTILITY
 * ============================================
 * 
 * Utility untuk enkripsi/dekripsi data sensitif menggunakan AES-256-GCM.
 * Digunakan untuk mengamankan WhatsApp session credentials di database.
 * 
 * Fitur:
 * - AES-256-GCM encryption (authenticated encryption)
 * - Random IV per enkripsi untuk keamanan optimal
 * - Authentication tag untuk integrity verification
 * - Graceful fallback untuk data legacy (tidak terenkripsi)
 * 
 * Environment Variables:
 * - SESSION_ENCRYPTION_KEY: 32-byte hex string (64 characters) atau base64
 * - SESSION_ENCRYPTION_ENABLED: 'true' untuk enable (default: true jika key ada)
 * 
 * ============================================
 */

import crypto from 'crypto';
import logger from '../config/logger';

// ============================================
// CONFIGURATION
// ============================================

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 16; // 16 bytes untuk AES
const AUTH_TAG_LENGTH = 16; // 16 bytes untuk GCM auth tag
const ENCRYPTED_PREFIX = 'enc:v1:'; // Prefix untuk identifikasi data terenkripsi

// Cache encryption key setelah validasi pertama
let cachedEncryptionKey: Buffer | null = null;
let encryptionEnabled: boolean | null = null;

/**
 * Validasi dan parse encryption key dari environment
 * Key harus 32 bytes (256 bits) untuk AES-256
 */
function getEncryptionKey(): Buffer | null {
    if (cachedEncryptionKey !== null) {
        return cachedEncryptionKey;
    }

    const keyEnv = process.env.SESSION_ENCRYPTION_KEY;
    
    if (!keyEnv) {
        logger.warn('[Encryption] SESSION_ENCRYPTION_KEY not set - encryption disabled');
        cachedEncryptionKey = null as any; // Mark as checked
        return null;
    }

    try {
        let keyBuffer: Buffer;

        // Try hex format first (64 chars = 32 bytes)
        if (/^[0-9a-fA-F]{64}$/.test(keyEnv)) {
            keyBuffer = Buffer.from(keyEnv, 'hex');
        }
        // Try base64 format
        else if (keyEnv.length >= 43) { // Base64 of 32 bytes = ~43 chars
            keyBuffer = Buffer.from(keyEnv, 'base64');
        }
        // Try raw string (will be hashed to 32 bytes)
        else {
            logger.warn('[Encryption] Key format not recognized, deriving key from passphrase');
            keyBuffer = crypto.createHash('sha256').update(keyEnv).digest();
        }

        if (keyBuffer.length !== 32) {
            throw new Error(`Invalid key length: ${keyBuffer.length} bytes (expected 32)`);
        }

        cachedEncryptionKey = keyBuffer;
        logger.info('[Encryption] Encryption key loaded successfully');
        return keyBuffer;
    } catch (error) {
        logger.error({ error }, '[Encryption] Failed to parse encryption key');
        cachedEncryptionKey = null as any;
        return null;
    }
}

/**
 * Check if encryption is enabled
 */
export function isEncryptionEnabled(): boolean {
    if (encryptionEnabled !== null) {
        return encryptionEnabled;
    }

    const explicitSetting = process.env.SESSION_ENCRYPTION_ENABLED;
    
    if (explicitSetting !== undefined) {
        encryptionEnabled = explicitSetting.toLowerCase() === 'true';
    } else {
        // Default: enabled if key is available
        encryptionEnabled = getEncryptionKey() !== null;
    }

    logger.info(`[Encryption] Session encryption ${encryptionEnabled ? 'ENABLED' : 'DISABLED'}`);
    return encryptionEnabled;
}

/**
 * Encrypt data using AES-256-GCM
 * 
 * Format output: enc:v1:<iv_hex>:<authTag_hex>:<ciphertext_hex>
 * 
 * @param plaintext - Data yang akan dienkripsi (string)
 * @returns Encrypted string dengan prefix, atau plaintext jika enkripsi disabled
 */
export function encrypt(plaintext: string): string {
    if (!isEncryptionEnabled()) {
        return plaintext;
    }

    const key = getEncryptionKey();
    if (!key) {
        logger.warn('[Encryption] Key not available, storing plaintext');
        return plaintext;
    }

    try {
        // Generate random IV untuk setiap enkripsi
        const iv = crypto.randomBytes(IV_LENGTH);
        
        // Create cipher - use type assertion to avoid Buffer compatibility issues
        const cipher = crypto.createCipheriv(
            ALGORITHM, 
            key as unknown as crypto.CipherKey, 
            iv as unknown as crypto.BinaryLike
        ) as crypto.CipherGCM;
        
        // Encrypt
        let encrypted = cipher.update(plaintext, 'utf8', 'hex');
        encrypted += cipher.final('hex');
        
        // Get auth tag
        const authTag = cipher.getAuthTag();
        
        // Format: prefix:iv:authTag:ciphertext
        return `${ENCRYPTED_PREFIX}${iv.toString('hex')}:${authTag.toString('hex')}:${encrypted}`;
    } catch (error) {
        logger.error({ error }, '[Encryption] Encryption failed, storing plaintext');
        return plaintext;
    }
}

/**
 * Decrypt data yang dienkripsi dengan AES-256-GCM
 * 
 * @param ciphertext - Data terenkripsi atau plaintext legacy
 * @returns Decrypted string
 */
export function decrypt(ciphertext: string): string {
    // Check if data is encrypted (has prefix)
    if (!ciphertext.startsWith(ENCRYPTED_PREFIX)) {
        // Legacy data (tidak terenkripsi), return as-is
        return ciphertext;
    }

    const key = getEncryptionKey();
    if (!key) {
        logger.error('[Encryption] Cannot decrypt: key not available');
        throw new Error('Encryption key not available for decryption');
    }

    try {
        // Parse encrypted data
        const withoutPrefix = ciphertext.slice(ENCRYPTED_PREFIX.length);
        const parts = withoutPrefix.split(':');
        
        if (parts.length !== 3) {
            throw new Error('Invalid encrypted data format');
        }

        const [ivHex, authTagHex, encryptedHex] = parts;
        
        const iv = Buffer.from(ivHex, 'hex');
        const authTag = Buffer.from(authTagHex, 'hex');

        // Validate lengths
        if (iv.length !== IV_LENGTH) {
            throw new Error(`Invalid IV length: ${iv.length}`);
        }
        if (authTag.length !== AUTH_TAG_LENGTH) {
            throw new Error(`Invalid auth tag length: ${authTag.length}`);
        }

        // Create decipher - use type assertion to avoid Buffer compatibility issues
        const decipher = crypto.createDecipheriv(
            ALGORITHM, 
            key as unknown as crypto.CipherKey, 
            iv as unknown as crypto.BinaryLike
        ) as crypto.DecipherGCM;
        decipher.setAuthTag(authTag as unknown as NodeJS.ArrayBufferView);
        
        // Decrypt using string encoding to avoid Buffer type issues
        let decrypted = decipher.update(encryptedHex, 'hex', 'utf8');
        decrypted += decipher.final('utf8');
        
        return decrypted;
    } catch (error) {
        logger.error({ error }, '[Encryption] Decryption failed');
        throw new Error('Failed to decrypt session data');
    }
}

/**
 * Check if a string is encrypted
 */
export function isEncrypted(data: string): boolean {
    return data.startsWith(ENCRYPTED_PREFIX);
}

/**
 * Generate a new random encryption key
 * Useful for initial setup
 * 
 * @returns 64-character hex string (32 bytes)
 */
export function generateEncryptionKey(): string {
    return crypto.randomBytes(32).toString('hex');
}

/**
 * Re-encrypt data with current key
 * Useful for key rotation or encrypting legacy data
 */
export function reEncrypt(data: string): string {
    const decrypted = decrypt(data);
    return encrypt(decrypted);
}

/**
 * Validate that encryption is properly configured
 * Call this at startup to ensure security
 */
export function validateEncryptionSetup(): { valid: boolean; message: string } {
    const enabled = isEncryptionEnabled();
    const key = getEncryptionKey();

    if (!enabled) {
        return {
            valid: true,
            message: 'Encryption is disabled (SESSION_ENCRYPTION_ENABLED=false or key not set)',
        };
    }

    if (!key) {
        return {
            valid: false,
            message: 'Encryption enabled but SESSION_ENCRYPTION_KEY is invalid or missing',
        };
    }

    // Test encryption/decryption
    try {
        const testData = 'test-encryption-' + Date.now();
        const encrypted = encrypt(testData);
        const decrypted = decrypt(encrypted);
        
        if (decrypted !== testData) {
            return {
                valid: false,
                message: 'Encryption self-test failed: decrypted data does not match',
            };
        }

        return {
            valid: true,
            message: 'Encryption is properly configured and working',
        };
    } catch (error) {
        return {
            valid: false,
            message: `Encryption self-test failed: ${error}`,
        };
    }
}
