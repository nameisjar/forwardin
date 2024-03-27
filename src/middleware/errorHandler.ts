import { Request, Response, NextFunction } from 'express';

export const internalServerErrorHandler = (
    err: Error,
    req: Request,
    res: Response,
    next: NextFunction,
) => {
    console.error(err); // Log the error for debugging purposes

    // Handle other types of errors
    return res.status(500).json({ error: 'Internal Server Error' });
};

export const notFoundHandler = (req: Request, res: Response, next: NextFunction) => {
    return res.status(404).json({ error: 'URL not found' });
};
