/**
 * ============================================
 * 🔐 API KEY HASHING UTILITY
 * ============================================
 * 
 * Utility untuk hashing API keys menggunakan SHA-256.
 * Digunakan untuk mengamankan Device.apiKey dan User.accountApiKey di database.
 * 
 * Mengapa Hash bukan Encrypt?
 * - API keys perlu di-lookup langsung di database (WHERE apiKey = ?)
 * - Jika di-encrypt, tidak bisa lookup langsung karena setiap encrypt menghasilkan ciphertext berbeda
 * - Hash menghasilkan output deterministik yang bisa di-index dan di-lookup
 * - Lebih aman karena tidak bisa di-reverse (one-way function)
 * 
 * Flow:
 * 1. Generate plain API key (UUID v4)
 * 2. Hash dengan SHA-256
 * 3. Simpan HASH ke database
 * 4. Kirim PLAIN key ke user (sekali saja, tidak disimpan)
 * 5. Saat validasi: hash input, compare dengan hash di database
 * 
 * ============================================
 */

import crypto from 'crypto';

// Prefix untuk membedakan hashed keys dari plain keys (backward compatibility)
const HASH_PREFIX = 'sha256:';

/**
 * Hash API key menggunakan SHA-256
 * @param plainKey - Plain API key (UUID)
 * @returns Hashed key dengan prefix 'sha256:'
 */
export function hashApiKey(plainKey: string): string {
    if (!plainKey) return '';
    
    // Jika sudah di-hash, return as-is
    if (plainKey.startsWith(HASH_PREFIX)) {
        return plainKey;
    }
    
    const hash = crypto.createHash('sha256').update(plainKey).digest('hex');
    return `${HASH_PREFIX}${hash}`;
}

/**
 * Verify apakah plain key cocok dengan stored hash
 * @param plainKey - Plain API key dari request
 * @param storedHash - Hash yang tersimpan di database
 * @returns true jika cocok
 */
export function verifyApiKey(plainKey: string, storedHash: string): boolean {
    if (!plainKey || !storedHash) return false;
    
    // Jika stored value bukan hash (legacy), compare langsung
    if (!storedHash.startsWith(HASH_PREFIX)) {
        return plainKey === storedHash;
    }
    
    // Hash plain key dan compare
    const hashedInput = hashApiKey(plainKey);
    return hashedInput === storedHash;
}

/**
 * Check apakah API key sudah di-hash
 * @param key - API key dari database
 * @returns true jika sudah di-hash
 */
export function isHashedApiKey(key: string): boolean {
    return key?.startsWith(HASH_PREFIX) ?? false;
}

/**
 * Generate new API key dan hash-nya
 * @returns { plainKey: string, hashedKey: string }
 */
export function generateHashedApiKey(): { plainKey: string; hashedKey: string } {
    const plainKey = crypto.randomUUID();
    const hashedKey = hashApiKey(plainKey);
    return { plainKey, hashedKey };
}
