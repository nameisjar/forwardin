import { expect } from 'chai';
import {
    OutboundPrivacyGuardError,
} from '../services/outboundPrivacyGuard';

describe('Outbound privacy guard', () => {
    it('marks confirmed recipient pauses with HTTP 423 metadata', () => {
        const error = new OutboundPrivacyGuardError(
            'RECIPIENT_463_PAUSED',
            'Penerima sedang dijeda',
        );

        expect(error.statusCode).to.equal(423);
        expect(error.code).to.equal('RECIPIENT_463_PAUSED');
        expect(error.message).to.equal('Penerima sedang dijeda');
    });
});
