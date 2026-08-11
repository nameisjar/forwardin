export type DeviceConnectionStatus =
    | 'open'
    | 'connecting'
    | 'reconnecting'
    | 'close'
    | 'logged_out';

type RuntimeStatusInput = {
    databaseStatus?: string | null;
    hasSession: boolean;
    hasInstance: boolean;
    connection?: string;
    reconnecting?: boolean;
};

/**
 * Baileys emits partial connection.update payloads. Only an explicit
 * connection value is allowed to change the public device status.
 */
export function normalizeConnectionUpdate(connection: unknown): DeviceConnectionStatus | null {
    if (typeof connection !== 'string') return null;

    const normalized = connection.trim().toLowerCase();
    if (normalized === 'open') return 'open';
    if (normalized === 'connecting') return 'connecting';
    if (normalized === 'close' || normalized === 'closed' || normalized === 'disconnected') {
        return 'close';
    }
    if (normalized === 'reconnecting') return 'reconnecting';
    if (normalized === 'logged_out') return 'logged_out';
    return null;
}

/** Exponential reconnect delay capped to avoid a tight reconnect loop. */
export function getReconnectDelay(
    attempt: number,
    baseDelayMs = 2000,
    maxDelayMs = 60000,
): number {
    const safeAttempt = Math.max(1, Math.floor(attempt || 1));
    const safeBase = Math.max(250, Math.floor(baseDelayMs || 2000));
    const safeMax = Math.max(safeBase, Math.floor(maxDelayMs || 60000));
    return Math.min(safeMax, safeBase * 2 ** (safeAttempt - 1));
}

/**
 * Derive one public status from database and in-memory session state.
 * Runtime state wins in both directions, so a stale DB value cannot report
 * an instance as online or hide an already-open connection.
 */
export function deriveDeviceRuntimeStatus({
    databaseStatus,
    hasSession,
    hasInstance,
    connection,
    reconnecting = false,
}: RuntimeStatusInput): DeviceConnectionStatus {
    const persisted = normalizeConnectionUpdate(databaseStatus) || 'close';

    if (!hasSession || !hasInstance) {
        return persisted === 'logged_out' ? 'logged_out' : 'close';
    }
    if (reconnecting) return 'reconnecting';

    const runtime = normalizeConnectionUpdate(connection);
    if (runtime) return runtime;

    return persisted === 'open' ? 'connecting' : persisted;
}
