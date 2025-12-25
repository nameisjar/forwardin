/**
 * ============================================
 * 🔐 MIGRATE API KEYS TO HASHED FORMAT
 * ============================================
 * 
 * Script untuk migrasi API keys yang belum di-hash ke format hashed.
 * 
 * Usage:
 *   npx tsx scripts/migrate-hash-api-keys.ts [--dry-run]
 * 
 * Options:
 *   --dry-run     Preview changes without modifying database
 * 
 * ============================================
 */

import { PrismaClient } from '@prisma/client';
import { hashApiKey, isHashedApiKey } from '../src/utils/apiKeyHash';

const prisma = new PrismaClient();

async function main() {
    const isDryRun = process.argv.includes('--dry-run');
    
    console.log('🔐 API Key Hash Migration');
    console.log('========================');
    console.log(`Mode: ${isDryRun ? 'DRY RUN (no changes)' : 'LIVE'}`);
    console.log('');

    // ============================================
    // 1. Migrate User.accountApiKey
    // ============================================
    console.log('📦 Checking User.accountApiKey...');
    
    const usersWithPlainKey = await prisma.user.findMany({
        where: {
            accountApiKey: {
                not: null,
            },
        },
        select: {
            pkId: true,
            email: true,
            accountApiKey: true,
        },
    });

    let userMigrated = 0;
    let userSkipped = 0;
    
    for (const user of usersWithPlainKey) {
        if (!user.accountApiKey) {
            userSkipped++;
            continue;
        }
        
        if (isHashedApiKey(user.accountApiKey)) {
            userSkipped++;
            continue;
        }
        
        const hashedKey = hashApiKey(user.accountApiKey);
        
        if (!isDryRun) {
            await prisma.user.update({
                where: { pkId: user.pkId },
                data: { accountApiKey: hashedKey },
            });
        }
        
        console.log(`  ✅ User ${user.email}: ${user.accountApiKey.substring(0, 8)}... → ${hashedKey.substring(0, 20)}...`);
        userMigrated++;
    }
    
    console.log(`  📊 Users: ${userMigrated} migrated, ${userSkipped} skipped`);
    console.log('');

    // ============================================
    // 2. Migrate Device.apiKey
    // ============================================
    console.log('📦 Checking Device.apiKey...');
    
    const devicesWithPlainKey = await prisma.device.findMany({
        select: {
            pkId: true,
            name: true,
            apiKey: true,
        },
    });

    let deviceMigrated = 0;
    let deviceSkipped = 0;
    
    for (const device of devicesWithPlainKey) {
        if (!device.apiKey) {
            deviceSkipped++;
            continue;
        }
        
        if (isHashedApiKey(device.apiKey)) {
            deviceSkipped++;
            continue;
        }
        
        const hashedKey = hashApiKey(device.apiKey);
        
        if (!isDryRun) {
            await prisma.device.update({
                where: { pkId: device.pkId },
                data: { apiKey: hashedKey },
            });
        }
        
        console.log(`  ✅ Device "${device.name}": ${device.apiKey.substring(0, 8)}... → ${hashedKey.substring(0, 20)}...`);
        deviceMigrated++;
    }
    
    console.log(`  📊 Devices: ${deviceMigrated} migrated, ${deviceSkipped} skipped`);
    console.log('');

    // ============================================
    // Summary
    // ============================================
    console.log('========================');
    console.log('📊 MIGRATION SUMMARY');
    console.log('========================');
    console.log(`Users migrated:   ${userMigrated}`);
    console.log(`Users skipped:    ${userSkipped}`);
    console.log(`Devices migrated: ${deviceMigrated}`);
    console.log(`Devices skipped:  ${deviceSkipped}`);
    console.log('');
    
    if (isDryRun) {
        console.log('⚠️  DRY RUN - No changes were made');
        console.log('   Run without --dry-run to apply changes');
    } else {
        console.log('✅ Migration completed successfully!');
    }
    
    console.log('');
    console.log('⚠️  IMPORTANT: After migration, existing plain API keys will NO LONGER WORK!');
    console.log('   Users will need to regenerate their API keys.');
}

main()
    .catch((e) => {
        console.error('❌ Migration failed:', e);
        process.exit(1);
    })
    .finally(async () => {
        await prisma.$disconnect();
    });
