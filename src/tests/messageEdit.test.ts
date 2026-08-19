import { expect } from 'chai';
import { proto } from '@whiskeysockets/baileys';
import {
    extractMessageEdit,
    extractMessageEditEnvelope,
    extractSupportedMessageText,
    isMessageEditEnvelope,
} from '../utils/messageEdit';

describe('WhatsApp message edit parsing', () => {
    it('recognizes protocol and normalized edit envelopes', () => {
        expect(isMessageEditEnvelope({
            protocolMessage: {
                type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            },
        })).to.equal(true);
        expect(isMessageEditEnvelope({
            editedMessage: { message: { conversation: 'teks baru' } },
        })).to.equal(true);
        expect(isMessageEditEnvelope({ conversation: 'pesan biasa' })).to.equal(false);
    });

    it('recognizes and parses group edit protocol wrappers', () => {
        const result = extractMessageEditEnvelope({
            groupStatusMessage: {
                message: {
                    protocolMessage: {
                        type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
                        key: { id: 'original-message-id' },
                        editedMessage: { conversation: 'teks grup setelah diedit' },
                        timestampMs: 1_787_155_200_000,
                    },
                },
            },
        }, 'edit-envelope-id', 1_787_155_190);

        expect(isMessageEditEnvelope({
            groupStatusMessage: {
                message: {
                    protocolMessage: {
                        type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
                    },
                },
            },
        })).to.equal(true);
        expect(result?.targetMessageId).to.equal('original-message-id');
        expect(result?.text).to.equal('teks grup setelah diedit');
        expect(result?.editedAt.toISOString()).to.equal('2026-08-19T16:00:00.000Z');
    });

    it('parses an edit folded into messages.upsert using the original key', () => {
        const result = extractMessageEditEnvelope({
            editedMessage: {
                message: { conversation: 'hasil edit buffer' },
            },
        }, 'original-from-upsert', 1_787_155_200);

        expect(result?.targetMessageId).to.equal('original-from-upsert');
        expect(result?.text).to.equal('hasil edit buffer');
    });

    it('extracts the edited text and edit timestamp', () => {
        const result = extractMessageEdit({
            message: {
                editedMessage: {
                    message: {
                        extendedTextMessage: { text: 'pesan setelah diedit' },
                    },
                },
            },
            messageTimestamp: 1_787_155_200,
        });

        expect(result?.text).to.equal('pesan setelah diedit');
        expect(result?.editedAt.toISOString()).to.equal('2026-08-19T16:00:00.000Z');
    });

    it('keeps media placeholders when an edited caption is empty', () => {
        expect(extractSupportedMessageText({ imageMessage: { caption: '' } }))
            .to.equal('[Gambar]');
        expect(extractSupportedMessageText({ videoMessage: { caption: '' } }))
            .to.equal('[Video]');
    });

    it('ignores unsupported updates instead of creating a generic message bubble', () => {
        expect(extractMessageEdit({
            message: {
                editedMessage: {
                    message: { protocolMessage: { type: 3 } },
                },
            },
        })).to.equal(null);
    });
});
