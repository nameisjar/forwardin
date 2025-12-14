// Simple helper to verify Postgres indexes exist (especially trigram index).
// Usage: node scripts/check-indexes.js

const { PrismaClient } = require('@prisma/client');

const prisma = new PrismaClient();

async function main() {
  const rows = await prisma.$queryRawUnsafe(`
    SELECT indexname, indexdef
    FROM pg_indexes
    WHERE schemaname='public'
      AND tablename='Broadcast'
      AND indexname IN (
        'idx_broadcast_name_trgm',
        'idx_broadcast_device_schedule',
        'idx_broadcast_device_name',
        'idx_broadcast_device_status_sent_schedule'
      )
    ORDER BY indexname;
  `);

  if (!rows || rows.length === 0) {
    console.log('No matching indexes found in pg_indexes for table "Broadcast".');
    return;
  }

  console.log('Indexes on public."Broadcast":');
  for (const r of rows) {
    console.log(`- ${r.indexname}`);
    console.log(`  ${r.indexdef}`);
  }
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
