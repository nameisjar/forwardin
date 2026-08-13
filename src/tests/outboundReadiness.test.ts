import { expect } from 'chai';
import { evaluateOutboundSendReadiness } from '../utils/outboundReadiness';

const READY_BASE = {
    generationCurrent: true,
    sessionConnected: true,
    authenticated: true,
    socketOpen: true,
};

describe('Outbound WhatsApp readiness', () => {
    it('rejects a stale socket generation even if it still looks authenticated', () => {
        expect(evaluateOutboundSendReadiness({
            ...READY_BASE,
            generationCurrent: false,
        })).to.include({
            ready: false,
            code: 'WHATSAPP_SESSION_NOT_READY',
            statusCode: 503,
        });
    });

    it('exposes an account reachout restriction as controlled 423', () => {
        expect(evaluateOutboundSendReadiness({
            ...READY_BASE,
            reachoutLock: {
                isActive: true,
                timeEnforcementEnds: new Date(2_000),
            },
            now: 1_000,
        })).to.deep.include({
            ready: false,
            code: 'WHATSAPP_REACHOUT_TIMELOCK',
            statusCode: 423,
            retryAt: new Date(2_000).toISOString(),
        });
    });

    it('enforces an active per-recipient 463 cooldown', () => {
        expect(evaluateOutboundSendReadiness({
            ...READY_BASE,
            recipientRetryAt: 2_000,
            now: 1_000,
        })).to.deep.include({
            ready: false,
            code: 'WHATSAPP_RECIPIENT_COOLDOWN',
            statusCode: 423,
        });
    });

    it('allows sending after restrictions expire', () => {
        expect(evaluateOutboundSendReadiness({
            ...READY_BASE,
            reachoutLock: { isActive: true, timeEnforcementEnds: new Date(500) },
            recipientRetryAt: 500,
            now: 1_000,
        })).to.deep.equal({ ready: true });
    });
});
