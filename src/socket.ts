import http from 'http';
import { Server } from 'socket.io';
import logger from './config/logger';

let io: Server;

export function initSocketServer(app: Express.Application): http.Server {
    const server = http.createServer(app);
    io = new Server(server, {
        cors: { origin: [`${process.env.CLIENT_URL1}`, `${process.env.CLIENT_URL2}`] },
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
            console.log('WebSocket client disconnected');
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
