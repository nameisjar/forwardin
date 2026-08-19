import { expect } from 'chai';
import {
    aesEncryptGCM,
    hmacSign,
    proto,
} from '@whiskeysockets/baileys';
import {
    decryptSecretMessageEdit,
    isSecretMessageEditEnvelope,
} from '../utils/secretMessageEdit';

describe('Secret-encrypted WhatsApp message edits', () => {
    it('decrypts a group edit using the original message secret', () => {
        const originalSecret = Buffer.alloc(32, 7);
        const targetMessageId = 'ORIGINAL-MESSAGE-ID';
        const authorJid = '207777777777@lid';
        const sign = Buffer.concat([
            Buffer.from(targetMessageId),
            Buffer.from(authorJid),
            Buffer.from(authorJid),
            Buffer.from('Message Edit'),
            new Uint8Array([1]),
        ]);
        const key0 = hmacSign(originalSecret, new Uint8Array(32), 'sha256');
        const key = hmacSign(sign, key0, 'sha256');
        const iv = Buffer.alloc(12, 3);
        const plaintext = proto.Message.encode({
            protocolMessage: {
                key: {
                    id: targetMessageId,
                    remoteJid: '120363000000000000@g.us',
                    participant: authorJid,
                    fromMe: true,
                },
                type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
                editedMessage: {
                    extendedTextMessage: { text: 'teks sesudah diedit' },
                },
                timestampMs: 1787184000000,
            },
        }).finish();
        const encPayload = aesEncryptGCM(plaintext, key, iv, Buffer.alloc(0));
        const content = {
            secretEncryptedMessage: {
                targetMessageKey: { id: targetMessageId },
                encPayload,
                encIv: iv,
                secretEncType: proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT,
            },
        };

        expect(isSecretMessageEditEnvelope(content)).to.equal(true);
        const result = decryptSecretMessageEdit({
            content,
            originalSecret,
            originalSenderCandidates: ['628111111111@s.whatsapp.net'],
            modificationSenderCandidates: ['wrong@lid', authorJid],
            editedAt: new Date('2026-08-20T00:00:00.000Z'),
        });
        expect(result?.targetMessageId).to.equal(targetMessageId);
        expect(result?.text).to.equal('teks sesudah diedit');
        expect(result?.editedAt.toISOString()).to.equal('2026-08-20T00:00:00.000Z');
    });

    it('does not classify other secret-encrypted event types as message edits', () => {
        expect(isSecretMessageEditEnvelope({
            secretEncryptedMessage: {
                secretEncType: proto.Message.SecretEncryptedMessage.SecretEncType.EVENT_EDIT,
            },
        })).to.equal(false);
    });
});
