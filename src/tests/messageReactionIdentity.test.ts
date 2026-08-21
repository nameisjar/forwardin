import { expect } from 'chai';
import {
    normalizeReactionPhone,
    resolveReactionDisplayName,
} from '../services/messageReaction';

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

    it('prefers the saved contact name over stored and WhatsApp names', () => {
        expect(resolveReactionDisplayName({
            contact: { firstName: 'Bramantyo', lastName: 'Parents' },
            storedDisplayName: 'Nama Saat Reaction',
            pushName: 'Nama Pesan Lama',
        })).to.equal('Bramantyo Parents');
    });

    it('uses the name captured with the reaction when no contact is saved', () => {
        expect(resolveReactionDisplayName({
            storedDisplayName: 'Rohani Suci',
            pushName: 'Nama Pesan Lama',
        })).to.equal('Rohani Suci');
    });
});
