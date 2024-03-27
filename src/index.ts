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
    server.listen(port, host, listener);
})();

export default app;
