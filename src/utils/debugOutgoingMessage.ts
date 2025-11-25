import { PrismaClient } from '@prisma/client';

// Initialize Prisma Client dengan konfigurasi yang benar
const prisma = new PrismaClient({
    // Pastikan Prisma tahu lokasi schema yang benar
    datasources: {
        db: {
            url: process.env.DATABASE_URL
        }
    }
});

/**
 * Script untuk debugging masalah OutgoingMessage
 * Jalankan dari root directory: npx ts-node src/utils/debugOutgoingMessage.ts
 */
async function debugOutgoingMessage() {
    try {
        console.log('🔍 Starting OutgoingMessage debugging...\n');

        // 1. Periksa koneksi database terlebih dahulu
        console.log('1️⃣ Testing database connection...');
        try {
            await prisma.$connect();
            console.log('✅ Database connection successful');
        } catch (error: any) {
            console.log('❌ Database connection failed:', error?.message || 'Unknown error');
            return;
        }

        // 2. Cek total records di OutgoingMessage
        console.log('\n2️⃣ Checking OutgoingMessage record count...');
        const totalRecords = await prisma.outgoingMessage.count();
        console.log(`📊 Total OutgoingMessage records: ${totalRecords}`);

        // 3. Cek records terbaru (10 terakhir) - menggunakan query raw untuk menghindari schema mismatch
        console.log('\n3️⃣ Checking recent OutgoingMessage records...');
        try {
            const recentMessages = await prisma.$queryRaw`
                SELECT id, "to", message, status, "created_at", "sessionId", "broadcastId", "isGroup"
                FROM "OutgoingMessage"
                ORDER BY "created_at" DESC
                LIMIT 10
            ` as any[];
            
            if (recentMessages.length > 0) {
                console.log('✅ Recent OutgoingMessage records:');
                console.table(recentMessages.map((msg: any) => ({
                    id: msg.id.substring(0, 20) + '...',
                    to: msg.to.substring(0, 20) + '...',
                    message: msg.message?.substring(0, 30) + '...' || 'null',
                    status: msg.status,
                    created_at: new Date(msg.created_at).toISOString().substring(0, 19),
                    broadcastId: msg.broadcastId || 'null',
                    isGroup: msg.isGroup !== null ? msg.isGroup.toString() : 'null'
                })));
            } else {
                console.log('⚠️  No OutgoingMessage records found');
            }
        } catch (error: any) {
            console.log('❌ Error querying OutgoingMessage:', error?.message || 'Unknown error');
        }

        // 4. Cek pending broadcasts
        console.log('\n4️⃣ Checking pending broadcasts...');
        try {
            const pendingBroadcasts = await prisma.broadcast.findMany({
                where: {
                    status: true,
                    isSent: false,
                    schedule: { lte: new Date() }
                },
                take: 5,
                select: {
                    id: true,
                    name: true,
                    schedule: true,
                    recipients: true,
                    device: {
                        select: {
                            sessions: { select: { sessionId: true } }
                        }
                    }
                }
            });

            if (pendingBroadcasts.length > 0) {
                console.log('📋 Pending broadcasts found:');
                console.table(pendingBroadcasts.map(bc => ({
                    id: bc.id.substring(0, 8) + '...',
                    name: bc.name.substring(0, 30),
                    schedule: bc.schedule.toISOString().substring(0, 19),
                    recipientCount: Array.isArray(bc.recipients) ? bc.recipients.length : 0,
                    hasSession: bc.device.sessions.length > 0
                })));
            } else {
                console.log('✅ No pending broadcasts found');
            }
        } catch (error: any) {
            console.log('❌ Error querying broadcasts:', error?.message || 'Unknown error');
        }

        // 5. Test insert OutgoingMessage menggunakan raw query
        console.log('\n5️⃣ Testing OutgoingMessage insert...');
        try {
            const testMessageId = `test_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            
            // Test insert menggunakan raw query untuk menghindari schema mismatch
            await prisma.$executeRaw`
                INSERT INTO "OutgoingMessage" (
                    id, "to", message, schedule, status, "sessionId", "contactId", 
                    "mediaPath", "broadcastId", "isGroup", "created_at", "updated_at"
                ) VALUES (
                    ${testMessageId}, 
                    '6281234567890@s.whatsapp.net',
                    'Test message for debugging',
                    NOW(),
                    'pending',
                    'test-session',
                    NULL,
                    NULL,
                    1,
                    false,
                    NOW(),
                    NOW()
                )
            `;

            console.log('✅ Test OutgoingMessage created successfully:', testMessageId);

            // Clean up test data
            await prisma.$executeRaw`DELETE FROM "OutgoingMessage" WHERE id = ${testMessageId}`;
            console.log('🧹 Test data cleaned up');

        } catch (error: any) {
            console.log('❌ Error creating test OutgoingMessage:', error?.message || 'Unknown error');
            console.log('💡 This might indicate schema issues or constraints problems');
        }

        // 6. Check sent broadcasts dan hubungannya dengan outgoing messages
        console.log('\n6️⃣ Checking sent broadcasts and their outgoing messages...');
        try {
            const sentBroadcastsQuery = await prisma.$queryRaw`
                SELECT 
                    b.id,
                    b.name,
                    b."pkId",
                    b.recipients,
                    b."updatedAt",
                    COUNT(om.id) as outgoing_count
                FROM "Broadcast" b
                LEFT JOIN "OutgoingMessage" om ON b."pkId" = om."broadcastId"
                WHERE b."isSent" = true 
                    AND b."updatedAt" >= NOW() - INTERVAL '24 hours'
                GROUP BY b.id, b.name, b."pkId", b.recipients, b."updatedAt"
                ORDER BY b."updatedAt" DESC
                LIMIT 5
            ` as any[];

            if (sentBroadcastsQuery.length > 0) {
                console.log('📤 Recent sent broadcasts:');
                sentBroadcastsQuery.forEach((broadcast: any) => {
                    console.log(`Broadcast: ${broadcast.name.substring(0, 30)}`);
                    console.log(`  ID: ${broadcast.id}`);
                    console.log(`  Recipients: ${Array.isArray(broadcast.recipients) ? broadcast.recipients.length : 0}`);
                    console.log(`  Related OutgoingMessages: ${broadcast.outgoing_count}`);
                    console.log(`  Sent at: ${new Date(broadcast.updatedAt).toISOString()}\n`);
                });
            } else {
                console.log('⚠️  No recently sent broadcasts found');
            }
        } catch (error: any) {
            console.log('❌ Error querying sent broadcasts:', error?.message || 'Unknown error');
        }

        console.log('\n✨ Debugging completed successfully!');

    } catch (error: any) {
        console.error('💥 Fatal error during debugging:', error?.message || 'Unknown error');
        console.error('Full error:', error);
    } finally {
        await prisma.$disconnect();
    }
}

// Jalankan debugging jika file dipanggil langsung
if (require.main === module) {
    debugOutgoingMessage().catch(console.error);
}

export default debugOutgoingMessage;