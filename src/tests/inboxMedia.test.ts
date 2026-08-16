import { expect } from 'chai';
import {
    resolveInboxMediaType,
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

    it('preserves the media kind before paths become extensionless signed URLs', () => {
        expect(resolveInboxMediaType('media/session/message.png')).to.equal('image');
        expect(resolveInboxMediaType('media/session/message.mp4')).to.equal('video');
        expect(resolveInboxMediaType('media/session/message.ogg')).to.equal('audio');
        expect(resolveInboxMediaType('media/session/message.bin', 'laporan.pdf')).to.equal('document');
    });

    it('recognizes database media and placeholders used by legacy messages', () => {
        expect(resolveInboxMediaType('data:image/webp;base64,AAAA')).to.equal('image');
        expect(resolveInboxMediaType('/inbox-media/device/message?token=abc', null, '[Gambar]'))
            .to.equal('image');
        expect(resolveInboxMediaType(null, null, '[Gambar]')).to.equal(null);
    });
});
