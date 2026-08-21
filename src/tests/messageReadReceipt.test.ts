import { expect } from 'chai';
import {
    normalizeReadReceiptPhone,
    parseMessageReadReceipts,
    receiptTimestamp,
    upsertMessageReadReceipt,
} from '../services/messageReadReceipt';

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
});
