import { expect } from 'chai';
import { buildInboxQuotedMessageContent } from '../services/inboxMessageQuote';

describe('Inbox media quote payload', () => {
    it('keeps an image target as an image message', () => {
        const content = buildInboxQuotedMessageContent({
            text: 'Foto jadwal kelas',
            mediaPath: 'uploads/inbox/example.jpg',
            fileName: 'jadwal.jpg',
        });

        expect(content.imageMessage).to.include({
            mimetype: 'image/jpeg',
            caption: 'Foto jadwal kelas',
        });
        expect(content.conversation).to.equal(undefined);
    });

    it('keeps document identity and does not use its placeholder as caption', () => {
        const content = buildInboxQuotedMessageContent({
            text: '[Dokumen]',
            mediaPath: 'uploads/inbox/example.pdf',
            fileName: 'materi.pdf',
        });

        expect(content.documentMessage).to.include({
            mimetype: 'application/pdf',
            fileName: 'materi.pdf',
            title: 'materi.pdf',
        });
        expect(content.documentMessage?.caption).to.equal(undefined);
    });

    it('uses the native sticker message type for sticker replies', () => {
        const content = buildInboxQuotedMessageContent({
            text: '[Stiker]',
            mediaPath: 'data:image/webp;base64,UklGRg==',
        });

        expect(content.stickerMessage?.mimetype).to.equal('image/webp');
        expect(content.imageMessage).to.equal(undefined);
    });

    it('continues to quote ordinary text as a conversation', () => {
        const content = buildInboxQuotedMessageContent({ text: 'Halo' });
        expect(content).to.deep.equal({ conversation: 'Halo' });
    });
});
