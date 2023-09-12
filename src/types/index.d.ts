declare global {
    namespace Express {
        interface Request {
            user?: User;
        }
    }
}

export interface DecodedToken {
    userId: number;
    email: string;
}
