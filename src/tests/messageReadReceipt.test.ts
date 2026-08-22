import { expect } from 'chai';
import {
    filterOwnMessageReadReceipts,
    filterOwnReadBy,
    normalizeReadReceiptPhone,
    parseMessageReadReceipts,
    receiptTimestamp,
    resolveReadReceiptIdentityAliases,
    upsertMessageReadReceipt,
} from '../services/messageReadReceipt';
import {
    buildOwnWhatsAppIdentityJids,
    canonicalPersonalPhoneJid,
    isOwnWhatsAppIdentity,
    phoneJidFromMessageKey,
} from '../utils/whatsappIdentity';

describe('message read receipts', () => {
    it('normalizes WhatsApp phone JIDs but keeps LID private', () => {
        expect(normalizeReadReceiptPhone('628123456789@s.whatsapp.net')).to.equal('628123456789');
        expect(normalizeReadReceiptPhone('12345@lid')).to.equal('');
    });

    it('converts WhatsApp second timestamps to an exact Date', () => {
        const result = receiptTimestamp(1_700_000_000);
        expect(result.date.toISOString()).to.equal('2023-11-14T22:13:20.000Z');
        expect(result.estimated).to.equal(false);
    });

    it('replaces an estimated timestamp with an exact receipt timestamp', () => {
        const readerJid = '628123456789@s.whatsapp.net';
        const result = upsertMessageReadReceipt(
            [{ readerJid, readAt: '2026-08-21T08:30:00.000Z', estimated: true }],
            { readerJid, readAt: '2026-08-21T08:15:00.000Z', estimated: false },
        );
        expect(result).to.deep.equal([
            { readerJid, readAt: '2026-08-21T08:15:00.000Z', estimated: false },
        ]);
    });

    it('ignores malformed stored receipt entries', () => {
        expect(parseMessageReadReceipts([
            null,
            { readerJid: '', readAt: 'invalid' },
            {
                readerJid: '628123456789@s.whatsapp.net',
                readAt: '2026-08-21T08:15:00.000Z',
                estimated: false,
            },
        ])).to.have.length(1);
    });

    it('filters the connected account from group readers for PN and LID identities', () => {
        const ownJids = buildOwnWhatsAppIdentityJids('628111111111', {
            id: '628111111111:7@s.whatsapp.net',
            lid: '123456789@lid',
        });
        expect(isOwnWhatsAppIdentity('628111111111@s.whatsapp.net', ownJids)).to.equal(true);
        expect(isOwnWhatsAppIdentity('123456789@lid', ownJids)).to.equal(true);
        expect(isOwnWhatsAppIdentity('123456789:4@lid', ownJids)).to.equal(true);
        expect(isOwnWhatsAppIdentity('628222222222@s.whatsapp.net', ownJids)).to.equal(false);
        expect(filterOwnReadBy([
            '628111111111@s.whatsapp.net',
            '123456789@lid',
            '628222222222@s.whatsapp.net',
        ], ownJids)).to.deep.equal(['628222222222@s.whatsapp.net']);
        expect(filterOwnMessageReadReceipts([
            {
                readerJid: '123456789@lid',
                readAt: '2026-08-21T08:15:00.000Z',
                estimated: false,
            },
            {
                readerJid: '628222222222@s.whatsapp.net',
                readAt: '2026-08-21T08:16:00.000Z',
                estimated: false,
            },
        ], ownJids)).to.have.length(1);
    });

    it('canonicalizes alternate personal conversation keys to the phone JID', () => {
        expect(canonicalPersonalPhoneJid('628123456789:12@s.whatsapp.net'))
            .to.equal('628123456789@s.whatsapp.net');
        expect(phoneJidFromMessageKey({
            remoteJid: '99887766@lid',
            remoteJidAlt: '628123456789:12@s.whatsapp.net',
        })).to.equal('628123456789@s.whatsapp.net');
        expect(canonicalPersonalPhoneJid('99887766@lid')).to.equal(null);
    });

    it('resolves a private reader LID through the active WhatsApp mapping', async () => {
        const aliases = await resolveReadReceiptIdentityAliases({
            signalRepository: {
                lidMapping: {
                    getPNForLID: async (jid) => jid === '99887766@lid'
                        ? '628123456789:12@s.whatsapp.net'
                        : null,
                },
            },
        }, '120363000000@g.us', ['99887766@lid']);

        expect(aliases.get('99887766@lid')).to.deep.equal({
            readerPhone: '628123456789',
            phoneJid: '628123456789@s.whatsapp.net',
            readerDisplayName: null,
        });
    });

    it('falls back to group metadata for a reader phone and WhatsApp name', async () => {
        const aliases = await resolveReadReceiptIdentityAliases({
            signalRepository: {
                lidMapping: { getPNForLID: async () => null },
            },
            groupMetadata: async () => ({
                participants: [{
                    id: '628987654321@s.whatsapp.net',
                    lid: '11223344@lid',
                    phoneNumber: '628987654321@s.whatsapp.net',
                    notify: 'Rohani Suci',
                }],
            }),
        }, '120363000000@g.us', ['11223344:4@lid']);

        expect(aliases.get('11223344:4@lid')).to.deep.equal({
            readerPhone: '628987654321',
            phoneJid: '628987654321@s.whatsapp.net',
            readerDisplayName: 'Rohani Suci',
        });
    });

    it('preserves cached reader identity fields in stored receipts', () => {
        expect(parseMessageReadReceipts([{
            readerJid: '99887766@lid',
            readAt: '2026-08-21T08:15:00.000Z',
            estimated: false,
            readerDisplayName: 'Niko',
            readerPhone: '+628123456789',
            profileJid: '628123456789@s.whatsapp.net',
        }])).to.deep.equal([{
            readerJid: '99887766@lid',
            readAt: '2026-08-21T08:15:00.000Z',
            estimated: false,
            readerDisplayName: 'Niko',
            readerPhone: '628123456789',
            profileJid: '628123456789@s.whatsapp.net',
        }]);
    });
});
