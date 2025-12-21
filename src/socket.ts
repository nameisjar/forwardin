import http from 'http';
import { Server } from 'socket.io';
import logger from './config/logger';

let io: Server;

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
    io.on('connection', (socket) => {
        logger.info(socket.id);

        // const data = {
        //     deviceId: '8631e4e7-b399-4b71-b741-a865a60df877',
        //     status: 'connecting',
        // };
        // socket.emit('statusUpdate', data);

        // socket.on('message', (message) => {
        //     logger.warn(`WebSocket client sent a message: ${message}`);
        //     socket.send(`WebSocket server received: ${message}`);
        // });

        socket.on('close', () => {
            // console.log('WebSocket client disconnected');
        });
    });
    return server;
}

export function getSocketIO(): Server {
    if (!io) {
        throw new Error('Socket.IO server not initialized.');
    }
    return io;
}
