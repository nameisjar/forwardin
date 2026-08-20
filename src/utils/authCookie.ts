import type { CookieOptions, Request, Response } from 'express';

export const REFRESH_TOKEN_COOKIE_NAME = 'forwardin_refresh_token';
// Persistent browser session. The cookie is renewed whenever the access token
// is refreshed, so an actively used login does not expire automatically.
export const REFRESH_TOKEN_MAX_AGE_MS = 10 * 365 * 24 * 60 * 60 * 1000;

const refreshTokenCookieOptions = (): CookieOptions => {
    const isProduction = process.env.NODE_ENV === 'production';

    return {
        httpOnly: true,
        secure: isProduction,
        sameSite: isProduction ? 'none' : 'lax',
        path: '/auth',
        maxAge: REFRESH_TOKEN_MAX_AGE_MS,
    };
};

export function setRefreshTokenCookie(res: Response, refreshToken: string): void {
    res.cookie(REFRESH_TOKEN_COOKIE_NAME, refreshToken, refreshTokenCookieOptions());
}

export function clearRefreshTokenCookie(res: Response): void {
    const { maxAge: _maxAge, ...options } = refreshTokenCookieOptions();
    res.clearCookie(REFRESH_TOKEN_COOKIE_NAME, options);
}

export function getRefreshToken(req: Request): string | undefined {
    const cookieHeader = req.headers.cookie || '';
    const cookieValue = cookieHeader
        .split(';')
        .map((part) => part.trim())
        .find((part) => part.startsWith(`${REFRESH_TOKEN_COOKIE_NAME}=`))
        ?.slice(REFRESH_TOKEN_COOKIE_NAME.length + 1);

    if (cookieValue) {
        try {
            return decodeURIComponent(cookieValue);
        } catch {
            return undefined;
        }
    }

    // Backward compatibility for existing non-browser API clients.
    return typeof req.body?.refreshToken === 'string' ? req.body.refreshToken : undefined;
}
