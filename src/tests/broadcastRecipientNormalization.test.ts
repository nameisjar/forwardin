import { expect } from 'chai';
import { normalizeBroadcastRecipient } from '../utils/recipients';

describe('Broadcast recipient normalization', () => {
    it('normalizes Indonesian local and formatted numbers', () => {
        expect(normalizeBroadcastRecipient('0812-3456-7890')).to.deep.equal({
            jid: '6281234567890@s.whatsapp.net',
            type: 'number',
        });
        expect(normalizeBroadcastRecipient('+62 (812) 3456-7890')).to.deep.equal({
            jid: '6281234567890@s.whatsapp.net',
            type: 'number',
        });
    });

    it('preserves valid international, group, and LID addressing', () => {
        expect(normalizeBroadcastRecipient('+1 202 555 0100')).to.deep.equal({
            jid: '12025550100@s.whatsapp.net',
            type: 'number',
        });
        expect(normalizeBroadcastRecipient('120363012345678901-1234567890')).to.deep.equal({
            jid: '120363012345678901-1234567890@g.us',
            type: 'group',
        });
        expect(normalizeBroadcastRecipient('987654321@LID')).to.deep.equal({
            jid: '987654321@lid',
            type: 'number',
        });
    });

    it('rejects malformed or unsupported recipients before send', () => {
        for (const recipient of [
            '',
            '123',
            'not-a-number',
            'phone628123456789',
            '123@example.com',
        ]) {
            expect(() => normalizeBroadcastRecipient(recipient)).to.throw();
        }
    });
});
