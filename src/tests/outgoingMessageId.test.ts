import { expect } from 'chai';
import {
    CLIENT_MESSAGE_ID_PATTERN,
    createTrackedMessageId,
} from '../utils/outgoingMessageId';

describe('Outgoing message ID reservation', () => {
    it('keeps a valid client ID and normalizes its casing', () => {
        const id = createTrackedMessageId(' 3eb00123456789abcdef01 ');
        expect(id).to.equal('3EB00123456789ABCDEF01');
    });

    it('replaces missing or malformed client IDs', () => {
        for (const requestedId of [undefined, '', 'temp-123', '3EB0ABC', '3EB0INVALID00000000000']) {
            const generated = createTrackedMessageId(requestedId, '628123456789:1@s.whatsapp.net');
            expect(generated).to.match(CLIENT_MESSAGE_ID_PATTERN);
            expect(generated).not.to.equal(requestedId);
        }
    });

    it('generates a new ID for independent sends', () => {
        expect(createTrackedMessageId()).not.to.equal(createTrackedMessageId());
    });
});

