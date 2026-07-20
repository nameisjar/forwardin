import { PrismaClient } from '@prisma/client';
import { getInstance } from '../whatsapp.js';
import pino from 'pino';

const prisma = new PrismaClient();
const logger = pino({ level: 'info' });

/**
 * Backfill profile pictures for existing incoming messages
 * Run this script once after deploying the profile picture feature
 * 
 * Usage:
 *   npm run build
 *   node dist/scripts/backfill-profile-pictures.js
 */
async function backfillProfilePictures() {
    try {
        logger.info('🚀 Starting profile picture backfill...');
        
        // Get all incoming messages without profile pictures
        const messagesWithoutPics = await prisma.incomingMessage.findMany({
            where: {
                profilePicUrl: null,
                from: {
                    // Only personal chats (not groups)
                    not: { contains: '@g.us' }
                }
            },
            select: {
                id: true,
                from: true,
                sessionId: true,
            },
            // Group by sender to avoid fetching same profile multiple times
            distinct: ['from', 'sessionId'],
        });
        
        logger.info(`📊 Found ${messagesWithoutPics.length} unique senders without profile pictures`);
        
        let successCount = 0;
        let errorCount = 0;
        let notFoundCount = 0;
        
        for (const msg of messagesWithoutPics) {
            try {
                const session = getInstance(msg.sessionId);
                
                if (!session || typeof session.profilePictureUrl !== 'function') {
                    logger.warn({ sessionId: msg.sessionId }, 'Session not available or profilePictureUrl method missing');
                    errorCount++;
                    continue;
                }
                
                // Fetch profile picture
                let profilePicUrl: string | null = null;
                try {
                    profilePicUrl = await session.profilePictureUrl(msg.from, 'image');
                } catch (picErr) {
                    // User might not have a profile picture
                    notFoundCount++;
                }
                
                if (profilePicUrl) {
                    // Update all messages from this sender
                    const updateResult = await prisma.incomingMessage.updateMany({
                        where: {
                            from: msg.from,
                            sessionId: msg.sessionId,
                            profilePicUrl: null,
                        },
                        data: {
                            profilePicUrl,
                        },
                    });
                    
                    logger.info({
                        from: msg.from,
                        sessionId: msg.sessionId,
                        updatedCount: updateResult.count,
                        profilePicUrl: profilePicUrl.substring(0, 50) + '...',
                    }, '✅ Updated messages with profile picture');
                    
                    successCount++;
                } else {
                    logger.debug({ from: msg.from }, 'No profile picture available');
                    notFoundCount++;
                }
                
                // Small delay to avoid rate limiting
                await new Promise(resolve => setTimeout(resolve, 100));
                
            } catch (err) {
                logger.error({ err, from: msg.from, sessionId: msg.sessionId }, '❌ Failed to fetch/update profile picture');
                errorCount++;
            }
        }
        
        logger.info({
            total: messagesWithoutPics.length,
            success: successCount,
            notFound: notFoundCount,
            errors: errorCount,
        }, '🎉 Profile picture backfill completed');
        
    } catch (error) {
        logger.error({ error }, '💥 Fatal error during backfill');
        throw error;
    } finally {
        await prisma.$disconnect();
    }
}

// Run the script
backfillProfilePictures()
    .then(() => {
        logger.info('✅ Script finished successfully');
        process.exit(0);
    })
    .catch((error) => {
        logger.error({ error }, '❌ Script failed');
        process.exit(1);
    });
