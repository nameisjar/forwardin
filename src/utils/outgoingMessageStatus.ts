export const OUTGOING_MESSAGE_STATUS_LEVELS = {
    pending: 1,
    server_ack: 2,
    delivery_ack: 3,
    read: 4,
    played: 5,
    // A rejection outranks optimistic/server ACK states. Delivery and read
    // receipts are handled explicitly because they are stronger evidence.
    error: Number.MAX_SAFE_INTEGER,
    failed: Number.MAX_SAFE_INTEGER,
} as const;

export type KnownOutgoingMessageStatus = keyof typeof OUTGOING_MESSAGE_STATUS_LEVELS;

const PROGRESS_STATUSES: KnownOutgoingMessageStatus[] = [
    'pending',
    'server_ack',
    'delivery_ack',
    'read',
    'played',
];

const TERMINAL_STATUSES = new Set<KnownOutgoingMessageStatus>(['error', 'failed']);
const DELIVERY_EVIDENCE_STATUSES = new Set<KnownOutgoingMessageStatus>([
    'delivery_ack',
    'read',
    'played',
]);

function asKnownStatus(status: unknown): KnownOutgoingMessageStatus | null {
    const value = String(status || '') as KnownOutgoingMessageStatus;
    return Object.prototype.hasOwnProperty.call(OUTGOING_MESSAGE_STATUS_LEVELS, value)
        ? value
        : null;
}

export function outgoingMessageStatusLevel(status: unknown): number {
    const knownStatus = asKnownStatus(status);
    return knownStatus ? OUTGOING_MESSAGE_STATUS_LEVELS[knownStatus] : 0;
}

export function isTerminalOutgoingMessageStatus(status: unknown): boolean {
    const knownStatus = asKnownStatus(status);
    return knownStatus ? TERMINAL_STATUSES.has(knownStatus) : false;
}

/**
 * Return whether an existing row may move to the incoming status.
 *
 * WhatsApp NACK/error may replace only pending or server_ack. Successful ACKs
 * move monotonically. A delivery/read receipt may repair an earlier rejection
 * because receipt evidence cannot exist unless the message reached WhatsApp.
 */
export function canApplyOutgoingMessageStatus(current: unknown, next: unknown): boolean {
    const currentStatus = asKnownStatus(current);
    const nextStatus = asKnownStatus(next);
    if (!nextStatus || currentStatus === nextStatus) return false;
    if (currentStatus && TERMINAL_STATUSES.has(currentStatus)) {
        return DELIVERY_EVIDENCE_STATUSES.has(nextStatus);
    }

    if (TERMINAL_STATUSES.has(nextStatus)) {
        return currentStatus === 'pending' || currentStatus === 'server_ack';
    }

    return outgoingMessageStatusLevel(nextStatus) > outgoingMessageStatusLevel(currentStatus);
}

/**
 * Status values that may be atomically replaced by `next` in a database filter.
 */
export function eligibleOutgoingMessageStatuses(next: unknown): KnownOutgoingMessageStatus[] {
    const nextStatus = asKnownStatus(next);
    if (!nextStatus) return [];

    if (TERMINAL_STATUSES.has(nextStatus)) {
        return ['pending', 'server_ack'];
    }

    const nextLevel = outgoingMessageStatusLevel(nextStatus);
    const eligible = PROGRESS_STATUSES.filter(
        (status) => outgoingMessageStatusLevel(status) < nextLevel,
    );
    if (DELIVERY_EVIDENCE_STATUSES.has(nextStatus)) {
        eligible.push('error', 'failed');
    }
    return eligible;
}
