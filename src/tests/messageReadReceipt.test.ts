import { expect } from 'chai';
import {
    filterOwnMessageReadReceipts,
    filterOwnReadBy,
    normalizeReadReceiptPhone,
    parseMessageReadReceipts,
    receiptTimestamp,
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
});
