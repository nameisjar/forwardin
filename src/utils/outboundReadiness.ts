export type OutboundSendReadiness = {
    ready: boolean;
    code?: string;
    message?: string;
    statusCode?: number;
    retryAt?: string;
};

export function evaluateOutboundSendReadiness(params: {
    generationCurrent: boolean;
    sessionConnected: boolean;
    authenticated: boolean;
    socketOpen: boolean;
    reachoutLock?: {
        isActive?: boolean;
        timeEnforcementEnds?: Date | string | number;
    };
    recipientRetryAt?: number | null;
    now?: number;
}): OutboundSendReadiness {
    const now = params.now ?? Date.now();
    if (!params.generationCurrent || !params.sessionConnected) {
        return {
            ready: false,
            code: 'WHATSAPP_SESSION_NOT_READY',
            statusCode: 503,
            message: 'Sesi WhatsApp sedang tidak terhubung atau menyambung ulang.',
        };
    }

    if (!params.authenticated || !params.socketOpen) {
        return {
            ready: false,
            code: 'WHATSAPP_SESSION_NOT_READY',
            statusCode: 503,
            message: 'Koneksi WhatsApp belum siap mengirim pesan.',
        };
    }

    const enforcementEnd = params.reachoutLock?.timeEnforcementEnds
        ? new Date(params.reachoutLock.timeEnforcementEnds).getTime()
        : null;
    if (
        params.reachoutLock?.isActive &&
        (!enforcementEnd || Number.isNaN(enforcementEnd) || enforcementEnd > now)
    ) {
        return {
            ready: false,
            code: 'WHATSAPP_REACHOUT_TIMELOCK',
            statusCode: 423,
            message: 'WhatsApp sedang membatasi pengiriman pesan dari akun ini.',
            ...(enforcementEnd && !Number.isNaN(enforcementEnd)
                ? { retryAt: new Date(enforcementEnd).toISOString() }
                : {}),
        };
    }

    if (params.recipientRetryAt && params.recipientRetryAt > now) {
        return {
            ready: false,
            code: 'WHATSAPP_RECIPIENT_COOLDOWN',
            statusCode: 423,
            message: 'Kontak ini baru saja ditolak WhatsApp (kode 463). Tunggu sebentar sebelum mencoba lagi.',
            retryAt: new Date(params.recipientRetryAt).toISOString(),
        };
    }

    return { ready: true };
}
