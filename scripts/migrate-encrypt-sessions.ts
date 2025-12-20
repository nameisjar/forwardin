/**
 * ============================================
 * 🔐 MIGRATE SESSION DATA TO ENCRYPTED FORMAT
 * ============================================
 * 
 * Script ini akan mengenkripsi semua session data yang masih plaintext
 * di database. Jalankan sekali setelah mengaktifkan enkripsi.
 * 
 * PENTING:
 * - Backup database sebelum menjalankan script ini
 * - Pastikan SESSION_ENCRYPTION_KEY sudah diset
 * - Script ini aman untuk dijalankan berulang kali (idempotent)
 * 
 * Usage:
 *   npx ts-node scripts/migrate-encrypt-sessions.ts
 *   atau
 *   npx tsx scripts/migrate-encrypt-sessions.ts
 * 
 * ============================================
 */

import { PrismaClient } from '@prisma/client';
import { encrypt, isEncrypted, isEncryptionEnabled, validateEncryptionSetup } from '../src/utils/encryption';

const prisma = new PrismaClient();

async function migrateSessionData() {
    console.log('🔐 Session Data Encryption Migration');
    console.log('=====================================\n');

    // Validate encryption setup
    const encryptionStatus = validateEncryptionSetup();
    if (!encryptionStatus.valid) {
        console.error('❌ Encryption not properly configured:');
        console.error(`   ${encryptionStatus.message}`);
        console.error('\n📝 To generate a key, run:');
        console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        console.error('\n   Then set SESSION_ENCRYPTION_KEY in your .env file');
        process.exit(1);
    }

    if (!isEncryptionEnabled()) {
        console.error('❌ Encryption is disabled. Set SESSION_ENCRYPTION_ENABLED=true');
        process.exit(1);
    }

    console.log('✅ Encryption is properly configured\n');

    // Get all sessions
    console.log('📊 Fetching all session records...');
    const sessions = await prisma.session.findMany({
        select: {
            pkId: true,
            id: true,
            sessionId: true,
            data: true,
        },
    });

    console.log(`   Found ${sessions.length} session records\n`);

    if (sessions.length === 0) {
        console.log('✅ No sessions to migrate');
        await prisma.$disconnect();
        return;
    }

    // Process each session
    let migrated = 0;
    let skipped = 0;
    let errors = 0;

    console.log('🔄 Processing sessions...\n');

    for (const session of sessions) {
        try {
            // Check if already encrypted
            if (isEncrypted(session.data)) {
                skipped++;
                continue;
            }

            // Encrypt the data
            const encryptedData = encrypt(session.data);

            // Update in database
            await prisma.session.update({
                where: { pkId: session.pkId },
                data: { data: encryptedData },
            });

            migrated++;
            
            // Log progress every 100 records
            if (migrated % 100 === 0) {
                console.log(`   Migrated ${migrated} sessions...`);
            }
        } catch (error) {
            errors++;
            console.error(`   ❌ Error migrating session ${session.id} (pkId: ${session.pkId}):`, error);
        }
    }

    console.log('\n=====================================');
    console.log('📊 Migration Summary:');
    console.log(`   ✅ Migrated: ${migrated}`);
    console.log(`   ⏭️  Skipped (already encrypted): ${skipped}`);
    console.log(`   ❌ Errors: ${errors}`);
    console.log('=====================================\n');

    if (errors > 0) {
        console.warn('⚠️  Some sessions failed to migrate. Please review the errors above.');
    } else {
        console.log('✅ Migration completed successfully!');
    }

    await prisma.$disconnect();
}

// Run migration
migrateSessionData().catch((error) => {
    console.error('❌ Migration failed:', error);
    process.exit(1);
});
