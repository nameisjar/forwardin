import { Request, Response, NextFunction } from 'express';
import logger from '../config/logger';

export const internalServerErrorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    // 🔧 Structured logging with pino instead of console.error
    logger.error({
        err: {
            message: err.message,
            stack: err.stack,
            name: err.name,
        },
        method: req.method,
        url: req.url,
        ip: req.ip,
    }, '[Error] Internal Server Error');

    // Return error details only in development
    return res.status(500).json({ 
        error: 'Internal Server Error',
        ...(process.env.NODE_ENV === 'development' && { 
            message: err.message,
            stack: err.stack 
        })
    });
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    return res.status(404).json({ error: 'URL not found' });
};
