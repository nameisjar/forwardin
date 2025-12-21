import http from 'http';
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import logger from './config/logger';
import { getComprehensivePDFStatus } from './services/pdfGenerator';
import { jwtSecretKey } from './utils/jwtGenerator';
import prisma from './utils/db';

let io: Server;

// Monitoring broadcast interval
let monitoringInterval: NodeJS.Timeout | null = null;

// 🔐 Admin privilege ID from environment
const SUPER_ADMIN_ID = Number(process.env.SUPER_ADMIN_ID) || 1;

// 🔐 Socket.IO CORS Configuration with fail-safe defaults (Issue 4.5)
function getSocketCorsOrigin(): string[] | boolean {
    const allowedOrigins = [process.env.CLIENT_URL1, process.env.CLIENT_URL2].filter(Boolean) as string[];
    const isProduction = process.env.NODE_ENV === 'production';
    const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;
    
    if (allowedOrigins.length === 0) {
        if (isDevelopment) {
            // Development: allow all origins for convenience
            logger.warn('[Socket.IO] ⚠️ No CLIENT_URL configured - allowing all origins (dev mode)');
            return true; // Socket.IO uses boolean true to allow all
        } else {
            // Production: block all cross-origin if not configured
            logger.error('[Socket.IO] ❌ No CLIENT_URL configured in production - blocking all CORS');
            return []; // Empty array = no origins allowed
        }
    }
    
    return allowedOrigins;
}

export function initSocketServer(app: Express.Application): http.Server {
    const server = http.createServer(app);
    io = new Server(server, {
        cors: {
            origin: getSocketCorsOrigin(),
            methods: ['GET', 'POST'],
        },
    });

    // 🔐 Socket authentication middleware
    io.use(async (socket, next) => {
        const token = socket.handshake.auth.token;
        
        // Allow connection without token (for non-admin features)
        // But mark socket as unauthenticated
        if (!token) {
            socket.data.authenticated = false;
            socket.data.isAdmin = false;
            return next();
        }
        
        try {
            const decoded = jwt.verify(token, jwtSecretKey) as any;
            
            // Find user by email
            const user = await prisma.user.findUnique({
                where: { email: decoded.email },
                include: { privilege: true }
            });
            
            if (user) {
                socket.data.authenticated = true;
                socket.data.user = user;
                socket.data.isAdmin = user.privilege?.pkId === SUPER_ADMIN_ID;
            } else {
                socket.data.authenticated = false;
                socket.data.isAdmin = false;
            }
            
            next();
        } catch (err) {
            // Invalid token - allow connection but mark as unauthenticated
            socket.data.authenticated = false;
            socket.data.isAdmin = false;
            next();
        }
    });

    io.on('connection', (socket) => {
        logger.info(`[Socket] Client connected: ${socket.id} (admin: ${socket.data.isAdmin})`);

        // 🔐 Handle monitoring room subscription (admin only)
        socket.on('monitoring:subscribe', () => {
            // Check if user is authenticated admin
            if (!socket.data.authenticated || !socket.data.isAdmin) {
                socket.emit('error', { 
                    code: 'ACCESS_DENIED',
                    message: 'Monitoring requires admin privileges' 
                });
                logger.warn(`[Socket] Unauthorized monitoring subscribe attempt from ${socket.id}`);
                return;
            }
            
            socket.join('monitoring');
            logger.info(`[Socket] Admin ${socket.id} subscribed to monitoring`);
            
            // Send initial status immediately
            emitMonitoringUpdate();
        });

        socket.on('monitoring:unsubscribe', () => {
            socket.leave('monitoring');
            logger.info(`[Socket] Client ${socket.id} unsubscribed from monitoring`);
        });

        socket.on('close', () => {
            // console.log('WebSocket client disconnected');
        });
    });

    // 🔧 Start monitoring broadcast (every 10 seconds)
    startMonitoringBroadcast();

    return server;
}

export function getSocketIO(): Server {
    if (!io) {
        throw new Error('Socket.IO server not initialized.');
    }
    return io;
}

/**
 * 🔧 Start periodic monitoring broadcast to subscribed clients
 */
function startMonitoringBroadcast() {
    if (monitoringInterval) {
        clearInterval(monitoringInterval);
    }

    // Broadcast monitoring updates every 10 seconds
    monitoringInterval = setInterval(async () => {
        const room = io.sockets.adapter.rooms.get('monitoring');
        if (room && room.size > 0) {
            await emitMonitoringUpdate();
        }
    }, 10000);

    logger.info('[Socket] Monitoring broadcast started (10s interval)');
}

/**
 * 🔧 Emit monitoring update to all subscribed clients
 */
async function emitMonitoringUpdate() {
    try {
        const pdfStatus = await getComprehensivePDFStatus();
        
        io.to('monitoring').emit('monitoring:update', {
            pdfGenerator: pdfStatus,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        logger.error('[Socket] Failed to emit monitoring update:', error);
    }
}

/**
 * 🔧 Emit device status change to monitoring clients
 */
export function emitDeviceStatusChange(deviceId: string, status: string, isConnected: boolean) {
    if (!io) return;
    
    io.to('monitoring').emit('monitoring:device', {
        deviceId,
        status,
        isConnected,
        timestamp: new Date().toISOString()
    });
}

/**
 * 🔧 Emit message sent event to monitoring clients
 */
export function emitMessageSent(data: { deviceId: string; status: string; broadcastType?: string }) {
    if (!io) return;
    
    io.to('monitoring').emit('monitoring:message', {
        ...data,
        timestamp: new Date().toISOString()
    });
}
