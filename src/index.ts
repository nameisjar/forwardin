import express from 'express';
import cors from 'cors';
import routes from './routes';
import logger from './config/logger';
import pinoHttp from 'pino-http';
import prisma from './utils/db';
import { init } from './whatsapp';
import bodyParser from 'body-parser';
import { initSocketServer } from './socket';
import http from 'http';
import { error } from 'console';
import { internalServerErrorHandler, notFoundHandler } from './middleware/errorHandler';
import { warmupBrowser } from './services/pdfGenerator';
import { shutdownRateLimiter } from './services/rateLimiter';

// Import scheduler untuk memastikan broadcast scheduler berjalan
import './controllers/broadcast';

const app = express();
app.use(pinoHttp({ logger }));
app.use(cors());

app.use(bodyParser.json({ limit: '500mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '500mb' }));
app.use(express.json());

app.use('/', routes);
app.use(notFoundHandler);
app.use(internalServerErrorHandler);

const server: http.Server = initSocketServer(app);

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
    
    // 🔥 Pre-warm Puppeteer browser for PDF generation
    await warmupBrowser();
    
    server.listen(port, host, listener);
})();

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
    logger.info(`[Server] ${signal} received - starting graceful shutdown...`);
    
    // Shutdown rate limiter
    await shutdownRateLimiter();
    
    // Close server
    server.close(() => {
        logger.info('[Server] HTTP server closed');
        process.exit(0);
    });
};

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

export default app;
