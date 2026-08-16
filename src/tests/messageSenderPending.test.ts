import { expect } from 'chai';
import {
    assertOutboundSessionReady,
    assertReturnedMessageId,
    getBroadcastRecipientFailureStatus,
    isSafePreDeliveryRetry,
    resolveTrackedOutboundMessageId,
    runWithPendingOutgoingMessage,
} from '../services/messageSender';
import { CLIENT_MESSAGE_ID_PATTERN } from '../utils/outgoingMessageId';

async function captureFailure(operation: Promise<unknown>): Promise<unknown> {
    try {
        await operation;
    } catch (error) {
        return error;
    }
    throw new Error('Expected operation to fail');
}

describe('Message sender pending reservation', () => {
    it('preserves a caller-provided message ID verbatim', () => {
        expect(
            resolveTrackedOutboundMessageId(
                { user: { id: '628123456789:1@s.whatsapp.net' } },
                'CPM_42_1786610000000',
            ),
        ).to.equal('CPM_42_1786610000000');
    });

    it('generates a WhatsApp-compatible tracked ID only when one is absent', () => {
        const generated = resolveTrackedOutboundMessageId({
            user: { id: '628123456789:1@s.whatsapp.net' },
        });
        expect(generated).to.match(CLIENT_MESSAGE_ID_PATTERN);
    });

    it('durably reserves pending state before invoking the send', async () => {
        const order: string[] = [];
        const result = await runWithPendingOutgoingMessage({
            persist: true,
            reserve: async () => {
                order.push('reserve');
            },
            send: async () => {
                order.push('send');
                return 'sent';
            },
            markFailed: async () => {
                order.push('mark-failed');
            },
        });

        expect(result).to.equal('sent');
        expect(order).to.deep.equal(['reserve', 'send']);
    });

    it('marks the reserved row as failed when sending throws', async () => {
        const order: string[] = [];
        const sendError = new Error('send failed');
        const error = await captureFailure(runWithPendingOutgoingMessage({
            persist: true,
            reserve: async () => {
                order.push('reserve');
            },
            send: async () => {
                order.push('send');
                throw sendError;
            },
            markFailed: async () => {
                order.push('mark-failed');
            },
        }));

        expect(error).to.equal(sendError);
        expect(order).to.deep.equal(['reserve', 'send', 'mark-failed']);
    });

    it('does not send or mark failure when pending persistence itself fails', async () => {
        const order: string[] = [];
        const reserveError = new Error('database unavailable');
        const error = await captureFailure(runWithPendingOutgoingMessage({
            persist: true,
            reserve: async () => {
                order.push('reserve');
                throw reserveError;
            },
            send: async () => {
                order.push('send');
            },
            markFailed: async () => {
                order.push('mark-failed');
            },
        }));

        expect(error).to.equal(reserveError);
        expect(order).to.deep.equal(['reserve']);
    });

    it('skips persistence entirely when persist is disabled', async () => {
        const order: string[] = [];
        await runWithPendingOutgoingMessage({
            persist: false,
            reserve: async () => {
                order.push('reserve');
            },
            send: async () => {
                order.push('send');
            },
            markFailed: async () => {
                order.push('mark-failed');
            },
        });

        expect(order).to.deep.equal(['send']);
    });

    it('returns the existing result without sending a duplicate stanza', async () => {
        const order: string[] = [];
        const result = await runWithPendingOutgoingMessage({
            persist: true,
            reserve: async () => {
                order.push('reserve');
                return false;
            },
            onDuplicate: async () => {
                order.push('duplicate');
                return 'existing-result';
            },
            send: async () => {
                order.push('send');
                return 'new-result';
            },
            markFailed: async () => {
                order.push('mark-failed');
            },
        });

        expect(result).to.equal('existing-result');
        expect(order).to.deep.equal(['reserve', 'duplicate']);
    });

    it('rejects a retired or reconnecting socket through the generation probe', () => {
        let captured: (Error & {
            code?: string;
            statusCode?: number;
            retryAt?: string;
        }) | undefined;
        try {
            assertOutboundSessionReady({
                getSendReadiness: () => ({
                    ready: false,
                    code: 'WHATSAPP_SESSION_NOT_READY',
                    statusCode: 503,
                    message: 'reconnecting',
                }),
            });
        } catch (error) {
            captured = error as typeof captured;
        }

        expect(captured).to.be.instanceOf(Error);
        if (!captured) throw new Error('Expected readiness failure');
        expect(captured.message).to.equal('reconnecting');
        expect(captured.code).to.equal('WHATSAPP_SESSION_NOT_READY');
        expect(captured.statusCode).to.equal(503);
    });

    it('propagates a controlled recipient cooldown without sending', () => {
        let captured: (Error & {
            code?: string;
            statusCode?: number;
            retryAt?: string;
        }) | undefined;
        try {
            assertOutboundSessionReady(
                {
                    getSendReadiness: () => ({
                        ready: false,
                        code: 'WHATSAPP_RECIPIENT_COOLDOWN',
                        statusCode: 423,
                        retryAt: '2026-08-13T10:00:00.000Z',
                    }),
                },
                '123@lid',
            );
        } catch (error) {
            captured = error as typeof captured;
        }

        if (!captured) throw new Error('Expected recipient cooldown failure');
        expect(captured.code).to.equal('WHATSAPP_RECIPIENT_COOLDOWN');
        expect(captured.statusCode).to.equal(423);
        expect(captured.retryAt).to.equal('2026-08-13T10:00:00.000Z');
    });

    it('allows a current open socket to continue', () => {
        expect(() => assertOutboundSessionReady({
            getSendReadiness: () => ({ ready: true }),
        })).not.to.throw();
    });

    it('rejects a missing or mismatched transport message ID', () => {
        expect(() => assertReturnedMessageId({ key: { id: 'EXPECTED' } }, 'EXPECTED'))
            .not.to.throw();
        expect(() => assertReturnedMessageId({ key: { id: 'OTHER' } }, 'EXPECTED'))
            .to.throw('ID pesan yang berbeda');
        expect(() => assertReturnedMessageId({}, 'EXPECTED'))
            .to.throw('tidak mengembalikan ID pesan');
    });

    it('retries only failures confirmed before WhatsApp delivery', () => {
        expect(isSafePreDeliveryRetry({ statusCode: 503 }, false)).to.equal(true);
        expect(isSafePreDeliveryRetry({ code: 'P1001' }, false)).to.equal(true);

        expect(isSafePreDeliveryRetry({ statusCode: 423 }, false)).to.equal(false);
        expect(isSafePreDeliveryRetry({ statusCode: 429 }, false)).to.equal(false);
        expect(isSafePreDeliveryRetry({ data: 429 }, false)).to.equal(false);
        expect(isSafePreDeliveryRetry({ output: { statusCode: 429 } }, false)).to.equal(
            false,
        );
        expect(
            isSafePreDeliveryRetry({ code: 'WHATSAPP_RECIPIENT_COOLDOWN' }, false),
        ).to.equal(false);
        expect(isSafePreDeliveryRetry(new Error('socket timeout'), true)).to.equal(false);
    });

    it('keeps ambiguous and terminal failures out of scheduler retries', () => {
        expect(
            getBroadcastRecipientFailureStatus({
                deliveryAttempted: false,
                retryable: true,
            }),
        ).to.equal('failed');
        expect(
            getBroadcastRecipientFailureStatus({
                deliveryAttempted: true,
                retryable: false,
            }),
        ).to.equal('uncertain');
        expect(
            getBroadcastRecipientFailureStatus({
                deliveryAttempted: false,
                retryable: false,
            }),
        ).to.equal('terminal_failed');
    });
});
