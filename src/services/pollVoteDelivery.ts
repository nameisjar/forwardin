type PendingPollVote = {
    finish: (failureCode: string | null) => void;
    timer: NodeJS.Timeout;
};

const pendingPollVotes = new Map<string, PendingPollVote>();

/**
 * WhatsApp may accept the outgoing stanza first, then reject malformed poll
 * updates asynchronously. Keep the request open briefly so a NACK is reported
 * instead of being saved as a successful vote.
 */
export const waitForPollVoteDelivery = (
    messageId: string,
    rejectionWindowMs = 3_500,
): { result: Promise<string | null>; cancel: () => void } => {
    let settled = false;
    let resolveResult: (failureCode: string | null) => void = () => undefined;
    const result = new Promise<string | null>(resolve => {
        resolveResult = resolve;
    });

    const finish = (failureCode: string | null) => {
        if (settled) return;
        settled = true;
        const entry = pendingPollVotes.get(messageId);
        if (entry) clearTimeout(entry.timer);
        pendingPollVotes.delete(messageId);
        resolveResult(failureCode);
    };
    const timer = setTimeout(() => finish(null), rejectionWindowMs);
    pendingPollVotes.set(messageId, { finish, timer });

    return {
        result,
        cancel: () => finish('SEND_CANCELLED'),
    };
};

export const rejectPendingPollVote = (
    messageId: string | null | undefined,
    failureCode?: string | null,
): boolean => {
    if (!messageId) return false;
    const pending = pendingPollVotes.get(messageId);
    if (!pending) return false;
    pending.finish(String(failureCode || 'UNKNOWN'));
    return true;
};
