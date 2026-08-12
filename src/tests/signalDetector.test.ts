import { expect } from 'chai';
import { classifyDisconnectReason } from '../services/signalDetector';

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
