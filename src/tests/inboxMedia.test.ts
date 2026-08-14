import { expect } from 'chai';
import {
    serializeInboxMediaPath,
    verifyInboxMediaToken,
} from '../utils/inboxMedia';

describe('Inbox media URLs', () => {
    it('protects both database data URLs and regular media paths', () => {
        const deviceId = '8fd8b7de-91a5-4ead-9750-5f9d3034e55a';
        const messageId = 'message-123';

        for (const source of ['data:image/png;base64,AAAA', 'media/example.png']) {
            const serialized = serializeInboxMediaPath(source, deviceId, messageId);
            expect(serialized).to.be.a('string').and.include('/inbox-media/');

            const parsed = new URL(String(serialized), 'https://example.test');
            expect(
                verifyInboxMediaToken(
                    deviceId,
                    messageId,
                    parsed.searchParams.get('token') || '',
                ),
            ).to.equal(true);
        }
    });

    it('preserves empty media values', () => {
        expect(serializeInboxMediaPath(null, 'device', 'message')).to.equal(null);
        expect(serializeInboxMediaPath(undefined, 'device', 'message')).to.equal(undefined);
    });
});
