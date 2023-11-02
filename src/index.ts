import express from 'express';
import cors from 'cors';
import routes from './routes';
import logger from './config/logger';
import pinoHttp from 'pino-http';
import prisma from './utils/db';
import { init } from './instance';
import bodyParser from 'body-parser';
import http from 'http';
import { Server } from 'socket.io';

const app = express();
app.use(pinoHttp({ logger }));
app.use(cors());
app.use(express.json());

// back here: adjust limit
app.use(bodyParser.json({ limit: '500mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '500mb' }));

app.use('/', routes);
app.all('*', (req, res) => res.status(404).json({ error: 'URL not found' }));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*' } });

// Handle WebSocket connections
io.on('connection', (socket) => {
    logger.warn(socket.id);

    const data = {
        deviceId: '8631e4e7-b399-4b71-b741-a865a60df877',
        status: 'connecting',
    };
    socket.emit('statusUpdate', data);

    socket.on('message', (message) => {
        logger.warn(`WebSocket client sent a message: ${message}`);
        socket.send(`WebSocket server received: ${message}`);
    });

    socket.on('close', () => {
        console.log('WebSocket client disconnected');
    });
});

const host = process.env.HOST || '0.0.0.0';
const port = Number(process.env.PORT || 3000);
const listener = () => logger.info(`Server is listening on http://${host}:${port}`);

prisma
    .$connect()
    .then(() => {
        logger.info('Connected to the database server');
    })
    .catch((error) => {
        logger.error('Failed to connect to the database server:', error);
        process.exit(1);
    });

(async () => {
    await init();
    server.listen(port, host, listener);
})();

export default app;
