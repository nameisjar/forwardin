/**
 * ============================================
 * 🔐 GENERATE ENCRYPTION KEY
 * ============================================
 * 
 * Script sederhana untuk generate encryption key yang aman
 * untuk SESSION_ENCRYPTION_KEY environment variable.
 * 
 * Usage:
 *   node scripts/generate-encryption-key.js
 * 
 * ============================================
 */

const crypto = require('crypto');

// Generate 32 random bytes (256 bits) for AES-256
const key = crypto.randomBytes(32).toString('hex');

console.log('🔐 Generated Encryption Key for Session Data');
console.log('=============================================\n');
console.log('Add this to your .env file:\n');
console.log(`SESSION_ENCRYPTION_KEY=${key}`);
console.log('\n# Optional: explicitly enable encryption (default: true if key is set)');
console.log('SESSION_ENCRYPTION_ENABLED=true');
console.log('\n=============================================');
console.log('⚠️  IMPORTANT:');
console.log('   - Keep this key SECRET and SECURE');
console.log('   - NEVER commit this key to version control');
console.log('   - BACKUP this key - losing it means losing access to encrypted sessions');
console.log('   - Use different keys for development and production');
console.log('=============================================\n');
