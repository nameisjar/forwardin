import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
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
import { validateEncryptionSetup, isEncryptionEnabled } from './utils/encryption';
import { shutdownScheduledJobs } from './controllers/device';

// Import scheduler untuk memastikan broadcast scheduler berjalan
import './controllers/broadcast';

const app = express();

// Trust reverse proxy (Cloudflare) so req.ip uses CF-Connecting-IP / X-Forwarded-For.
app.set('trust proxy', true);

// 🛡️ Security headers (Helmet.js)
app.use(helmet({
    contentSecurityPolicy: false, // Disable CSP for API (no HTML responses)
    crossOriginEmbedderPolicy: false, // Allow embedding for WebSocket
}));

app.use(pinoHttp({ logger }));

// 🔐 CORS Configuration with fail-safe defaults (Issue 4.5)
const allowedOrigins = [process.env.CLIENT_URL1, process.env.CLIENT_URL2].filter(Boolean) as string[];
const isProduction = process.env.NODE_ENV === 'production';
const isDevelopment = process.env.NODE_ENV === 'development' || !process.env.NODE_ENV;

// Warn if no origins configured
if (allowedOrigins.length === 0) {
    if (isProduction) {
        logger.error('[Security] ❌ CORS: No CLIENT_URL configured in production!');
        logger.error('[Security] ❌ CORS: Set CLIENT_URL1 and/or CLIENT_URL2 environment variables');
        logger.error('[Security] ❌ CORS: All cross-origin requests will be BLOCKED');
    } else {
        logger.warn('[Security] ⚠️ CORS: No CLIENT_URL configured - allowing all origins (dev mode only)');
    }
}

app.use(
    cors({
        origin: (origin, cb) => {
            // Allow same-origin or non-browser clients with no Origin header
            if (!origin) return cb(null, true);
            
            // 🔐 FIX: Fail-safe default - only allow all origins in development
            if (allowedOrigins.length === 0) {
                if (isDevelopment) {
                    // Development: permissive for convenience
                    return cb(null, true);
                } else {
                    // Production: block if not configured (fail-safe)
                    logger.warn({ origin }, '[Security] CORS blocked - no allowed origins configured');
                    return cb(new Error('CORS not configured - request blocked'));
                }
            }
            
            if (allowedOrigins.includes(origin)) return cb(null, true);
            
            logger.warn({ origin, allowedOrigins }, '[Security] CORS blocked - origin not in allowlist');
            return cb(new Error('Not allowed by CORS'));
        },
        credentials: false,
    }),
);

// 🛡️ Global Rate Limiter - 100 requests per minute per IP
const globalLimiter = rateLimit({
    windowMs: 1 * 60 * 1000, // 1 minute
    max: 100, // max 100 requests per IP per minute
    message: { error: 'Too many requests, please try again later.', retryAfter: 60 },
    standardHeaders: true,
    legacyHeaders: false,
    handler: (req, res) => {
        logger.warn({ ip: req.ip, path: req.path }, '[Security] Rate limit exceeded');
        res.status(429).json({ error: 'Too many requests, please try again later.' });
    },
});
app.use(globalLimiter);

// 🔐 Stricter rate limiter for auth endpoints - 10 attempts per 15 minutes
const authLimiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 10, // max 10 attempts per 15 minutes
    message: { error: 'Too many login attempts, please try again later.', retryAfter: 900 },
    standardHeaders: true,
    legacyHeaders: false,
    skipSuccessfulRequests: true, // Only count failed attempts
});
app.use('/auth/login', authLimiter);
app.use('/auth/register', authLimiter);

// 🔧 Body limit reduced from 500mb to 10mb for security
app.use(bodyParser.json({ limit: '10mb' }));
app.use(bodyParser.urlencoded({ extended: true, limit: '10mb' }));
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
    // 🔐 Validate encryption setup before initializing WhatsApp sessions
    const encryptionStatus = validateEncryptionSetup();
    if (!encryptionStatus.valid) {
        logger.error(`[Security] ${encryptionStatus.message}`);
        logger.error('[Security] Please set SESSION_ENCRYPTION_KEY environment variable');
        logger.error('[Security] Generate a key with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"');
        // In production, you might want to exit here:
        // process.exit(1);
    } else {
        logger.info(`[Security] ${encryptionStatus.message}`);
    }

    // Warn if encryption is disabled in production
    if (process.env.NODE_ENV === 'production' && !isEncryptionEnabled()) {
        logger.warn('[Security] ⚠️ SESSION ENCRYPTION IS DISABLED IN PRODUCTION!');
        logger.warn('[Security] ⚠️ WhatsApp credentials are stored in PLAINTEXT');
        logger.warn('[Security] ⚠️ Set SESSION_ENCRYPTION_KEY to enable encryption');
    }

    await init();
    
    // 🔥 Pre-warm Puppeteer browser for PDF generation
    await warmupBrowser();
    
    server.listen(port, host, listener);
})();

// Graceful shutdown handler
const gracefulShutdown = async (signal: string) => {
    logger.info(`[Server] ${signal} received - starting graceful shutdown...`);
    
    // Shutdown scheduled jobs (prevents memory leaks)
    shutdownScheduledJobs();
    
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

// 🛡️ Handle unhandled promise rejections
process.on('unhandledRejection', (reason: unknown, promise: Promise<unknown>) => {
    logger.error({ reason, promise: String(promise) }, '[Process] Unhandled Promise Rejection');
});

// 🛡️ Handle uncaught exceptions - must exit as state is unreliable
process.on('uncaughtException', (error: Error) => {
    logger.fatal({ err: error }, '[Process] Uncaught Exception - shutting down');
    process.exit(1);
});

export default app;
