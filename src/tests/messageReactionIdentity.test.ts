import { expect } from 'chai';
import { normalizeReactionPhone } from '../services/messageReaction';

describe('Message reaction identity', () => {
    it('normalizes a WhatsApp phone JID with a device suffix', () => {
        expect(normalizeReactionPhone('6285228000522:12@s.whatsapp.net')).to.equal(
            '6285228000522',
        );
    });

    it('does not expose linked-device and group identifiers as phone numbers', () => {
        expect(normalizeReactionPhone('123456789@lid')).to.equal('');
        expect(normalizeReactionPhone('120363123456789@g.us')).to.equal('');
    });
});
