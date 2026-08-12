import { expect } from 'chai';
import {
    OutboundPrivacyGuardError,
    privacyGuardConfig,
} from '../services/outboundPrivacyGuard';

describe('Outbound privacy guard', () => {
    it('keeps the legacy permissive send behavior by default', () => {
        expect(privacyGuardConfig.recipientBlockEnabled).to.equal(false);
    });

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
