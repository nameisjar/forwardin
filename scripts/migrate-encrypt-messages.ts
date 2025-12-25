/**
 * ============================================
 * 🔐 MIGRATE MESSAGE DATA TO ENCRYPTED FORMAT
 * ============================================
 * 
 * Script ini akan mengenkripsi semua message data yang masih plaintext
 * di database. Jalankan sekali setelah mengaktifkan enkripsi.
 * 
 * Tables yang di-migrate:
 * - OutgoingMessage.message
 * - IncomingMessage.content
 * - Broadcast.message
 * 
 * PENTING:
 * - Backup database sebelum menjalankan script ini
 * - Pastikan SESSION_ENCRYPTION_KEY sudah diset
 * - Script ini aman untuk dijalankan berulang kali (idempotent)
 * 
 * Usage:
 *   npx ts-node scripts/migrate-encrypt-messages.ts
 *   atau
 *   npx tsx scripts/migrate-encrypt-messages.ts
 * 
 * Options:
 *   --dry-run    Preview changes without actually encrypting
 *   --table=X    Only migrate specific table (outgoing|incoming|broadcast)
 *   --batch=N    Batch size for processing (default: 100)
 * 
 * ============================================
 */

import { PrismaClient } from '@prisma/client';
import { encrypt, isEncrypted, isEncryptionEnabled, validateEncryptionSetup } from '../src/utils/encryption';

const prisma = new PrismaClient();

// Parse command line arguments
const args = process.argv.slice(2);
const isDryRun = args.includes('--dry-run');
const tableArg = args.find(a => a.startsWith('--table='))?.split('=')[1];
const batchSize = parseInt(args.find(a => a.startsWith('--batch='))?.split('=')[1] || '100');

interface MigrationStats {
    total: number;
    migrated: number;
    skipped: number;
    errors: number;
}

async function migrateOutgoingMessages(): Promise<MigrationStats> {
    const stats: MigrationStats = { total: 0, migrated: 0, skipped: 0, errors: 0 };
    
    console.log('\n📤 Migrating OutgoingMessage.message...');
    
    const count = await prisma.outgoingMessage.count({
        where: { message: { not: null } }
    });
    stats.total = count;
    console.log(`   Found ${count} records with message field`);

    if (count === 0) return stats;

    let processed = 0;
    while (processed < count) {
        const messages = await prisma.outgoingMessage.findMany({
            where: { message: { not: null } },
            select: { pkId: true, message: true },
            skip: processed,
            take: batchSize,
        });

        if (messages.length === 0) break;

        for (const msg of messages) {
            try {
                if (!msg.message || isEncrypted(msg.message)) {
                    stats.skipped++;
                    continue;
                }

                const encryptedMessage = encrypt(msg.message);

                if (!isDryRun) {
                    await prisma.outgoingMessage.update({
                        where: { pkId: msg.pkId },
                        data: { message: encryptedMessage },
                    });
                }

                stats.migrated++;
            } catch (error) {
                stats.errors++;
                console.error(`   ❌ Error migrating OutgoingMessage pkId ${msg.pkId}:`, error);
            }
        }

        processed += messages.length;
        console.log(`   Processed ${processed}/${count} records...`);
    }

    return stats;
}

async function migrateIncomingMessages(): Promise<MigrationStats> {
    const stats: MigrationStats = { total: 0, migrated: 0, skipped: 0, errors: 0 };
    
    console.log('\n📥 Migrating IncomingMessage.message...');
    
    const count = await prisma.incomingMessage.count();
    stats.total = count;
    console.log(`   Found ${count} records with message field`);

    if (count === 0) return stats;

    let processed = 0;
    while (processed < count) {
        const messages = await prisma.incomingMessage.findMany({
            select: { pkId: true, message: true },
            skip: processed,
            take: batchSize,
        });

        if (messages.length === 0) break;

        for (const msg of messages) {
            try {
                if (!msg.message || isEncrypted(msg.message)) {
                    stats.skipped++;
                    continue;
                }

                const encryptedMessage = encrypt(msg.message);

                if (!isDryRun) {
                    await prisma.incomingMessage.update({
                        where: { pkId: msg.pkId },
                        data: { message: encryptedMessage },
                    });
                }

                stats.migrated++;
            } catch (error) {
                stats.errors++;
                console.error(`   ❌ Error migrating IncomingMessage pkId ${msg.pkId}:`, error);
            }
        }

        processed += messages.length;
        console.log(`   Processed ${processed}/${count} records...`);
    }

    return stats;
}

async function migrateBroadcasts(): Promise<MigrationStats> {
    const stats: MigrationStats = { total: 0, migrated: 0, skipped: 0, errors: 0 };
    
    console.log('\n📣 Migrating Broadcast.message...');
    
    const count = await prisma.broadcast.count();
    stats.total = count;
    console.log(`   Found ${count} records with message field`);

    if (count === 0) return stats;

    let processed = 0;
    while (processed < count) {
        const broadcasts = await prisma.broadcast.findMany({
            select: { pkId: true, message: true },
            skip: processed,
            take: batchSize,
        });

        if (broadcasts.length === 0) break;

        for (const bc of broadcasts) {
            try {
                if (!bc.message || isEncrypted(bc.message)) {
                    stats.skipped++;
                    continue;
                }

                const encryptedMessage = encrypt(bc.message);

                if (!isDryRun) {
                    await prisma.broadcast.update({
                        where: { pkId: bc.pkId },
                        data: { message: encryptedMessage },
                    });
                }

                stats.migrated++;
            } catch (error) {
                stats.errors++;
                console.error(`   ❌ Error migrating Broadcast pkId ${bc.pkId}:`, error);
            }
        }

        processed += broadcasts.length;
        console.log(`   Processed ${processed}/${count} records...`);
    }

    return stats;
}

async function main() {
    console.log('🔐 Message Data Encryption Migration');
    console.log('=====================================');
    
    if (isDryRun) {
        console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    }

    // Validate encryption setup
    const encryptionStatus = validateEncryptionSetup();
    if (!encryptionStatus.valid) {
        console.error('\n❌ Encryption not properly configured:');
        console.error(`   ${encryptionStatus.message}`);
        console.error('\n📝 To generate a key, run:');
        console.error('   node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        console.error('\n   Then set SESSION_ENCRYPTION_KEY in your .env file');
        process.exit(1);
    }

    if (!isEncryptionEnabled()) {
        console.error('\n❌ Encryption is disabled. Set SESSION_ENCRYPTION_ENABLED=true');
        process.exit(1);
    }

    console.log('✅ Encryption is properly configured');
    console.log(`📦 Batch size: ${batchSize}`);

    const results: { [key: string]: MigrationStats } = {};

    // Migrate based on table argument or all tables
    if (!tableArg || tableArg === 'outgoing') {
        results.outgoing = await migrateOutgoingMessages();
    }
    if (!tableArg || tableArg === 'incoming') {
        results.incoming = await migrateIncomingMessages();
    }
    if (!tableArg || tableArg === 'broadcast') {
        results.broadcast = await migrateBroadcasts();
    }

    // Print summary
    console.log('\n=====================================');
    console.log('📊 Migration Summary');
    console.log('=====================================\n');

    let totalMigrated = 0;
    let totalSkipped = 0;
    let totalErrors = 0;

    for (const [table, stats] of Object.entries(results)) {
        console.log(`${table}:`);
        console.log(`   Total:    ${stats.total}`);
        console.log(`   Migrated: ${stats.migrated}`);
        console.log(`   Skipped:  ${stats.skipped} (already encrypted)`);
        console.log(`   Errors:   ${stats.errors}`);
        console.log('');

        totalMigrated += stats.migrated;
        totalSkipped += stats.skipped;
        totalErrors += stats.errors;
    }

    console.log('-------------------------------------');
    console.log(`Total Migrated: ${totalMigrated}`);
    console.log(`Total Skipped:  ${totalSkipped}`);
    console.log(`Total Errors:   ${totalErrors}`);

    if (isDryRun) {
        console.log('\n⚠️  This was a DRY RUN. Run without --dry-run to apply changes.');
    } else if (totalMigrated > 0) {
        console.log('\n✅ Migration completed successfully!');
    } else if (totalSkipped > 0) {
        console.log('\n✅ All messages are already encrypted.');
    }

    await prisma.$disconnect();
}

main().catch(async (error) => {
    console.error('\n❌ Migration failed:', error);
    await prisma.$disconnect();
    process.exit(1);
});
