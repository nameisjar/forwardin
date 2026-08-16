import { expect } from 'chai';
import {
    BroadcastRecipientLimitError,
    classifyConsentIntent,
    normalizeRecipientKey,
} from '../services/broadcastSafety';

describe('broadcast safety', () => {
    it('recognizes explicit opt-out and opt-in messages only', () => {
        expect(classifyConsentIntent('BERHENTI')).to.equal('opt_out');
        expect(classifyConsentIntent('jangan kirim lagi!')).to.equal('opt_out');
        expect(classifyConsentIntent('mulai')).to.equal('opt_in');
        expect(classifyConsentIntent('Saya ingin berhenti setelah kelas')).to.equal(null);
    });

    it('normalizes personal recipients without suppressing groups', () => {
        expect(normalizeRecipientKey('+62 812-3456-7890')).to.equal('6281234567890');
        expect(normalizeRecipientKey('6281234567890@s.whatsapp.net')).to.equal(
            '6281234567890',
        );
        expect(normalizeRecipientKey('120363000000@g.us')).to.equal(null);
    });

    it('provides an actionable error when a broadcast is too large', () => {
        const error = new BroadcastRecipientLimitError(120, 100);
        expect(error.statusCode).to.equal(400);
        expect(error.message).to.include('120');
        expect(error.message).to.include('100');
    });
});
