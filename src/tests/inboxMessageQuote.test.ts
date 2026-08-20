import { expect } from 'chai';
import {
    buildInboxQuotedMessageContent,
    buildQuotedSenderIdentity,
    buildQuotedSenderLabel,
} from '../services/inboxMessageQuote';

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

describe('Inbox quoted sender label', () => {
    it('prefers the saved contact name over phone and WhatsApp push name', () => {
        expect(
            buildQuotedSenderLabel({
                contact: { firstName: 'Bramantyo', lastName: 'Parents' },
                jid: '6281234567890@s.whatsapp.net',
                pushName: 'Rohani Suci',
            }),
        ).to.equal('Bramantyo Parents');
    });

    it('uses the WhatsApp push name as the label when contact is missing', () => {
        expect(
            buildQuotedSenderLabel({
                jid: '6281234567890:12@s.whatsapp.net',
                pushName: 'Rohani Suci',
            }),
        ).to.equal('Rohani Suci');
    });

    it('keeps the clean phone beside the push name for an unsaved contact', () => {
        expect(
            buildQuotedSenderIdentity({
                jid: '6281234567890:12@s.whatsapp.net',
                pushName: 'Rohani Suci',
            }),
        ).to.deep.equal({
            name: 'Rohani Suci',
            phone: '+6281234567890',
        });
    });

    it('does not repeat the phone when the push name is also a number', () => {
        expect(
            buildQuotedSenderIdentity({
                jid: '6281234567890@s.whatsapp.net',
                pushName: '+62 812-3456-7890',
            }),
        ).to.deep.equal({
            name: '+6281234567890',
            phone: null,
        });
    });

    it('does not expose a linked-device identifier', () => {
        expect(
            buildQuotedSenderLabel({
                jid: '123456789@lid',
                pushName: 'Rohani Suci',
            }),
        ).to.equal('Rohani Suci');
    });
});
