import { expect } from 'chai';
import { calculateHealthStatus, classifyDisconnectReason } from '../services/signalDetector';

describe('WhatsApp disconnect classification', () => {
    it('treats connectionClosed 428 as temporary', () => {
        const result = classifyDisconnectReason(428, 'Connection Closed');
        expect(result.signalType).to.equal('connection_error');
        expect(result.severity).to.equal('info');
    });

    it('treats replaced and invalid sessions as terminal logout states', () => {
        for (const code of [401, 403, 411, 440, 500]) {
            const result = classifyDisconnectReason(code, 'session ended');
            expect(result.signalType, `code ${code}`).to.equal('forced_logout');
            expect(result.severity, `code ${code}`).to.equal('critical');
        }
    });

    it('only labels a disconnect as banned when the response says so explicitly', () => {
        expect(classifyDisconnectReason(500, 'bad session').signalType).to.equal('forced_logout');
        expect(classifyDisconnectReason(403, 'account banned').signalType).to.equal('banned');
    });

    it('recognizes rate-limit text before generic temporary wording', () => {
        const result = classifyDisconnectReason(0, 'Too many requests, try again later');
        expect(result.signalType).to.equal('rate_limit');
    });
});

describe('Device health lifecycle', () => {
    const signal = (signalType: string, severity: string, minute: number) => ({
        signalType,
        severity,
        createdAt: new Date(`2026-08-14T00:${String(minute).padStart(2, '0')}:00.000Z`),
    });

    it('does not let resume hide a WhatsApp logout that still needs pairing', () => {
        const status = calculateHealthStatus([
            signal('resumed', 'info', 20),
            signal('forced_logout', 'critical', 10),
        ]);

        expect(status).to.equal('critical');
    });

    it('clears connection failures only after WhatsApp reconnects successfully', () => {
        const status = calculateHealthStatus([
            signal('reconnected', 'info', 20),
            signal('forced_logout', 'critical', 10),
        ]);

        expect(status).to.equal('healthy');
    });

    it('keeps rate-limit risk independent from a reconnect', () => {
        const status = calculateHealthStatus([
            signal('reconnected', 'info', 20),
            signal('rate_limit', 'warning', 10),
        ]);

        expect(status).to.equal('warning');
    });

    it('clears rate-limit escalation after the pause cooldown is resumed', () => {
        const status = calculateHealthStatus([
            signal('resumed', 'info', 20),
            signal('rate_limit', 'warning', 13),
            signal('rate_limit', 'warning', 12),
            signal('rate_limit', 'warning', 11),
        ]);

        expect(status).to.equal('healthy');
    });
});
