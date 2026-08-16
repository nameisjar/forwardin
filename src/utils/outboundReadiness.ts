export type OutboundSendReadiness = {
    ready: boolean;
    code?: string;
    message?: string;
    statusCode?: number;
    retryAt?: string;
    enforcementType?: string;
    restrictionScope?: 'recipient' | 'companion' | 'account';
};

function resolveReachoutRestrictionScope(
    enforcementType: string | null | undefined,
): 'companion' | 'account' | null {
    const normalizedType = String(enforcementType || '').trim().toUpperCase();

    // Baileys documents DEFAULT as "no restriction". An active flag without
    // a concrete enforcement type must not turn one recipient's 463 into a
    // local account-wide block.
    if (!normalizedType || normalizedType === 'DEFAULT') return null;

    if (normalizedType.includes('COMPANION')) return 'companion';
    return 'account';
}

export function evaluateOutboundSendReadiness(params: {
    generationCurrent: boolean;
    sessionConnected: boolean;
    authenticated: boolean;
    socketOpen: boolean;
    reachoutLock?: {
        isActive?: boolean;
        timeEnforcementEnds?: Date | string | number;
        enforcementType?: string;
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
    const enforcementType = params.reachoutLock?.enforcementType;
    const restrictionScope = resolveReachoutRestrictionScope(enforcementType);
    if (
        params.reachoutLock?.isActive &&
        restrictionScope &&
        (!enforcementEnd || Number.isNaN(enforcementEnd) || enforcementEnd > now)
    ) {
        return {
            ready: false,
            code: 'WHATSAPP_REACHOUT_TIMELOCK',
            statusCode: 423,
            message: restrictionScope === 'companion'
                ? 'WhatsApp sedang membatasi pengiriman melalui perangkat tertaut ini. WhatsApp asli mungkin tetap dapat digunakan.'
                : 'WhatsApp sedang membatasi pengiriman pesan dari akun ini.',
            enforcementType,
            restrictionScope,
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
            restrictionScope: 'recipient',
        };
    }

    return { ready: true };
}
