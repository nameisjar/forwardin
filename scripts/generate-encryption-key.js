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

// Generate independent 32-byte keys for AES-256.
const sessionKey = crypto.randomBytes(32).toString('hex');
const messageKey = crypto.randomBytes(32).toString('hex');

console.log('🔐 Generated Independent Encryption Keys');
console.log('=============================================\n');
console.log('Add this to your .env file:\n');
console.log(`SESSION_ENCRYPTION_KEY=${sessionKey}`);
console.log('\n# Optional: explicitly enable encryption (default: true if key is set)');
console.log('SESSION_ENCRYPTION_ENABLED=true');
console.log(`\nMESSAGE_ENCRYPTION_KEY=${messageKey}`);
console.log('MESSAGE_ENCRYPTION_KEY_ID=primary');
console.log('MESSAGE_ENCRYPTION_ENABLED=true');
console.log('\n=============================================');
console.log('⚠️  IMPORTANT:');
console.log('   - Keep this key SECRET and SECURE');
console.log('   - NEVER commit this key to version control');
console.log('   - BACKUP these keys - losing them means losing access to encrypted data');
console.log('   - Use different keys for development and production');
console.log('=============================================\n');
