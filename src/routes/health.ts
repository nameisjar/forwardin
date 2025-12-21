import { Router, Request, Response } from 'express';
import { getComprehensivePDFStatus, getPDFQueueStats, getBrowserHealthStatus } from '../services/pdfGenerator';
import { authMiddleware, superAdminOnly } from '../middleware/auth';
import prisma from '../utils/db';
import logger from '../config/logger';
import { getConnectedSessionsInfo, getInstance, verifyInstance } from '../whatsapp';

const router = Router();

// Track server start time for uptime calculation
const serverStartTime = Date.now();

// 🔒 Input validation constants
const ALLOWED_SORT_FIELDS = ['name', 'phone', 'messageCount', 'updatedAt'];
const ALLOWED_STATUS_FILTERS = ['all', 'connected', 'disconnected'];
const MAX_SEARCH_LENGTH = 100;
const MAX_DAYS_ANALYTICS = 90;

/**
 * 🔒 Sanitize search input to prevent injection attacks
 */
function sanitizeSearch(input: string): string {
    if (!input) return '';
    // Remove SQL wildcards and limit length
    return input
        .replace(/[%_\\]/g, '')
        .substring(0, MAX_SEARCH_LENGTH)
        .trim();
}

/**
 * 🔧 Health Check Endpoint for monitoring
 * GET /health - Basic health check (no auth)
 */
router.get('/', async (req: Request, res: Response) => {
    try {
        // Quick database ping
        await prisma.$queryRaw`SELECT 1`;
        
        res.status(200).json({
            status: 'ok',
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('[Health] Basic health check failed:', error);
        res.status(503).json({
            status: 'error',
            message: 'Service unavailable',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * 🔧 PDF System Status Endpoint
 * GET /health/pdf - Detailed PDF system status (requires admin auth)
 */
router.get('/pdf', authMiddleware, superAdminOnly, async (req: Request, res: Response) => {
    try {
        const status = await getComprehensivePDFStatus();
        
        res.status(200).json(status);
    } catch (error) {
        logger.error('[Health] PDF health check failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get PDF system status',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * 🔧 Queue Stats Endpoint (lightweight)
 * GET /health/queue - Just queue stats without browser health check (requires admin auth)
 */
router.get('/queue', authMiddleware, superAdminOnly, async (req: Request, res: Response) => {
    try {
        const stats = getPDFQueueStats();
        
        res.status(200).json({
            queue: stats,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('[Health] Queue stats failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get queue stats',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * 🔧 Browser Health Endpoint
 * GET /health/browser - Puppeteer browser status (requires admin auth)
 */
router.get('/browser', authMiddleware, superAdminOnly, async (req: Request, res: Response) => {
    try {
        const browserHealth = await getBrowserHealthStatus();
        
        res.status(200).json({
            browser: browserHealth,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('[Health] Browser health check failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get browser status',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * 🔧 System Overview Endpoint (for monitoring dashboard)
 * GET /health/overview - Complete system overview (requires admin auth)
 */
router.get('/overview', authMiddleware, superAdminOnly, async (req: Request, res: Response) => {
    try {
        const startTime = Date.now();
        
        // Database health check with latency
        let dbStatus = 'healthy';
        let dbLatency = 0;
        try {
            const dbStart = Date.now();
            await prisma.$queryRaw`SELECT 1`;
            dbLatency = Date.now() - dbStart;
        } catch {
            dbStatus = 'error';
        }

        // Get PDF system status
        const pdfStatus = await getComprehensivePDFStatus();

        // Get connected sessions using helper function
        const connectedSessions = getConnectedSessionsInfo();

        // Get device statistics from database
        const [deviceStats, messageStats, broadcastCount] = await Promise.all([
            prisma.device.groupBy({
                by: ['status'],
                _count: { id: true }
            }),
            prisma.outgoingMessage.groupBy({
                by: ['status'],
                _count: { id: true },
                where: {
                    createdAt: {
                        gte: new Date(Date.now() - 24 * 60 * 60 * 1000) // Last 24 hours
                    }
                }
            }),
            prisma.broadcast.count({
                where: {
                    status: true,
                    isSent: false
                }
            })
        ]);

        // Calculate uptime
        const uptime = Date.now() - serverStartTime;

        res.status(200).json({
            status: dbStatus === 'healthy' && pdfStatus.status === 'healthy' ? 'healthy' : 'degraded',
            uptime: {
                ms: uptime,
                formatted: formatUptime(uptime)
            },
            database: {
                status: dbStatus,
                latencyMs: dbLatency
            },
            pdfGenerator: pdfStatus,
            whatsapp: {
                connectedSessions: connectedSessions.length,
                sessions: connectedSessions
            },
            devices: {
                byStatus: deviceStats.reduce((acc, d) => {
                    acc[d.status] = d._count.id;
                    return acc;
                }, {} as Record<string, number>),
                total: deviceStats.reduce((sum, d) => sum + d._count.id, 0)
            },
            messages: {
                last24h: messageStats.reduce((acc, m) => {
                    acc[m.status] = m._count.id;
                    acc.total = (acc.total || 0) + m._count.id;
                    return acc;
                }, {} as Record<string, number>)
            },
            broadcasts: {
                pending: broadcastCount
            },
            responseTime: Date.now() - startTime,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('[Health] Overview failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get system overview',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * 🔧 Message Analytics Endpoint
 * GET /health/analytics/messages - Message statistics over time (requires admin auth)
 */
router.get('/analytics/messages', authMiddleware, superAdminOnly, async (req: Request, res: Response) => {
    try {
        // 🔒 Limit days parameter to prevent excessive data queries
        const days = Math.min(MAX_DAYS_ANALYTICS, Math.max(1, parseInt(req.query.days as string) || 7));
        const startDate = new Date();
        startDate.setDate(startDate.getDate() - days);

        // Get all messages in date range using Prisma
        const messages = await prisma.outgoingMessage.findMany({
            where: {
                createdAt: { gte: startDate }
            },
            select: {
                createdAt: true,
                status: true
            }
        });

        // Group by date manually
        const dailyMap = new Map<string, { total: number; delivered: number; read: number; failed: number }>();
        
        for (const msg of messages) {
            const dateKey = msg.createdAt.toISOString().split('T')[0];
            
            if (!dailyMap.has(dateKey)) {
                dailyMap.set(dateKey, { total: 0, delivered: 0, read: 0, failed: 0 });
            }
            
            const stats = dailyMap.get(dateKey)!;
            stats.total++;
            
            if (['delivery_ack', 'server_ack', 'read'].includes(msg.status)) {
                stats.delivered++;
            }
            if (msg.status === 'read') {
                stats.read++;
            }
            if (['failed', 'error'].includes(msg.status)) {
                stats.failed++;
            }
        }

        // Convert to sorted array
        const formattedStats = Array.from(dailyMap.entries())
            .map(([date, stats]) => ({ date, ...stats }))
            .sort((a, b) => a.date.localeCompare(b.date));

        // Calculate totals
        const totals = formattedStats.reduce((acc, day) => ({
            total: acc.total + day.total,
            delivered: acc.delivered + day.delivered,
            read: acc.read + day.read,
            failed: acc.failed + day.failed
        }), { total: 0, delivered: 0, read: 0, failed: 0 });

        res.status(200).json({
            period: {
                days,
                startDate: startDate.toISOString(),
                endDate: new Date().toISOString()
            },
            daily: formattedStats,
            totals,
            rates: {
                deliveryRate: totals.total > 0 ? ((totals.delivered / totals.total) * 100).toFixed(1) : '0',
                readRate: totals.total > 0 ? ((totals.read / totals.total) * 100).toFixed(1) : '0',
                failureRate: totals.total > 0 ? ((totals.failed / totals.total) * 100).toFixed(1) : '0'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('[Health] Message analytics failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get message analytics',
            timestamp: new Date().toISOString()
        });
    }
});

/**
 * 🔧 Device Status Endpoint
 * GET /health/devices - All devices with their connection status (requires admin auth)
 * Query params:
 *   - page: number (default 1)
 *   - limit: number (default 10, max 100)
 *   - status: string (filter by connection status: 'connected' | 'disconnected' | 'all')
 *   - search: string (search by name or phone, max 100 chars)
 *   - sortBy: string (field to sort: 'name' | 'phone' | 'messageCount' | 'updatedAt')
 *   - sortOrder: string ('asc' | 'desc')
 */
router.get('/devices', authMiddleware, superAdminOnly, async (req: Request, res: Response) => {
    try {
        // 🔒 Validate and sanitize all input parameters
        const page = Math.max(1, parseInt(req.query.page as string) || 1);
        const limit = Math.min(100, Math.max(1, parseInt(req.query.limit as string) || 10));
        
        // 🔒 Validate status against whitelist
        const rawStatus = (req.query.status as string) || 'all';
        const statusFilter = ALLOWED_STATUS_FILTERS.includes(rawStatus) ? rawStatus : 'all';
        
        // 🔒 Sanitize search input
        const search = sanitizeSearch(req.query.search as string);
        
        // 🔒 Validate sortBy against whitelist
        const rawSortBy = (req.query.sortBy as string) || 'updatedAt';
        const sortBy = ALLOWED_SORT_FIELDS.includes(rawSortBy) ? rawSortBy : 'updatedAt';
        
        const sortOrder = (req.query.sortOrder as string) === 'asc' ? 'asc' : 'desc';

        // Build where clause for search
        const whereClause: any = {};
        if (search) {
            whereClause.OR = [
                { name: { contains: search, mode: 'insensitive' } },
                { phone: { contains: search, mode: 'insensitive' } }
            ];
        }

        // Get total count for pagination
        const totalCount = await prisma.device.count({ where: whereClause });

        // Get all devices with their sessions and broadcast counts
        const devices = await prisma.device.findMany({
            where: whereClause,
            include: {
                user: {
                    select: { firstName: true, email: true }
                },
                sessions: {
                    select: { id: true, sessionId: true }
                },
                _count: {
                    select: {
                        Broadcast: true
                    }
                }
            },
            orderBy: sortBy === 'name' || sortBy === 'phone' || sortBy === 'updatedAt' 
                ? { [sortBy]: sortOrder }
                : { updatedAt: 'desc' }
        });

        // Get session IDs for outgoing message count
        const sessionIds = devices
            .flatMap(d => d.sessions.map(s => s.sessionId))
            .filter(Boolean);

        // Get outgoing message counts per session
        const outgoingCounts = await prisma.outgoingMessage.groupBy({
            by: ['sessionId'],
            where: {
                sessionId: { in: sessionIds }
            },
            _count: { id: true }
        });

        const outgoingCountMap = new Map(
            outgoingCounts.map(c => [c.sessionId, c._count.id])
        );

        // Check which sessions are actually connected and add message counts
        let devicesWithStatus = devices.map(device => {
            const session = device.sessions[0];
            const sessionId = session?.sessionId;
            let isConnected = false;
            
            // Check if session exists and is connected
            if (sessionId && verifyInstance(sessionId)) {
                try {
                    const instance = getInstance(sessionId);
                    isConnected = !!instance?.user;
                } catch {
                    isConnected = false;
                }
            }

            // Calculate total messages (broadcasts + outgoing messages from session)
            const broadcastCount = device._count?.Broadcast || 0;
            const outgoingCount = sessionId ? (outgoingCountMap.get(sessionId) || 0) : 0;
            const messageCount = broadcastCount + outgoingCount;

            return {
                id: device.id,
                pkId: device.pkId,
                name: device.name,
                phone: device.phone,
                status: device.status,
                isConnected,
                user: device.user,
                messageCount,
                broadcastCount,
                outgoingCount,
                createdAt: device.createdAt,
                updatedAt: device.updatedAt
            };
        });

        // Filter by connection status
        if (statusFilter === 'connected') {
            devicesWithStatus = devicesWithStatus.filter(d => d.isConnected);
        } else if (statusFilter === 'disconnected') {
            devicesWithStatus = devicesWithStatus.filter(d => !d.isConnected);
        }

        // Sort by messageCount if requested (can't be done in DB query)
        if (sortBy === 'messageCount') {
            devicesWithStatus.sort((a, b) => {
                return sortOrder === 'asc' 
                    ? a.messageCount - b.messageCount 
                    : b.messageCount - a.messageCount;
            });
        }

        // Apply pagination after filtering
        const filteredTotal = devicesWithStatus.length;
        const startIndex = (page - 1) * limit;
        const paginatedDevices = devicesWithStatus.slice(startIndex, startIndex + limit);

        const summary = {
            total: totalCount,
            filtered: filteredTotal,
            connected: devicesWithStatus.filter(d => d.isConnected).length,
            disconnected: devicesWithStatus.filter(d => !d.isConnected).length,
            byStatus: devicesWithStatus.reduce((acc, d) => {
                acc[d.status] = (acc[d.status] || 0) + 1;
                return acc;
            }, {} as Record<string, number>)
        };

        const pagination = {
            page,
            limit,
            totalPages: Math.ceil(filteredTotal / limit),
            totalItems: filteredTotal,
            hasNext: page < Math.ceil(filteredTotal / limit),
            hasPrev: page > 1
        };

        res.status(200).json({
            devices: paginatedDevices,
            summary,
            pagination,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('[Health] Device status failed:', error);
        res.status(500).json({
            status: 'error',
            message: 'Failed to get device status',
            timestamp: new Date().toISOString()
        });
    }
});

// Helper function to format uptime
function formatUptime(ms: number): string {
    const seconds = Math.floor(ms / 1000);
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const days = Math.floor(hours / 24);

    if (days > 0) return `${days}d ${hours % 24}h ${minutes % 60}m`;
    if (hours > 0) return `${hours}h ${minutes % 60}m ${seconds % 60}s`;
    if (minutes > 0) return `${minutes}m ${seconds % 60}s`;
    return `${seconds}s`;
}

export default router;
