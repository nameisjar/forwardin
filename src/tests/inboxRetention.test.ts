import { expect } from 'chai';
import {
    calculateInboxCutoff,
    normalizeRetentionDays,
} from '../services/inboxRetention';

describe('Inbox retention helpers', () => {
    it('calculates the cutoff using whole retention days', () => {
        const now = new Date('2026-08-10T12:00:00.000Z');
        expect(calculateInboxCutoff(30, now).toISOString()).to.equal(
            '2026-07-11T12:00:00.000Z',
        );
    });

    it('accepts retention values from 1 through 3650 days', () => {
        expect(normalizeRetentionDays('90')).to.equal(90);
        expect(normalizeRetentionDays(1)).to.equal(1);
        expect(normalizeRetentionDays(3650)).to.equal(3650);
    });

    it('rejects invalid retention values', () => {
        for (const value of [0, 3651, 1.5, 'abc', null]) {
            expect(() => normalizeRetentionDays(value)).to.throw('Masa penyimpanan');
        }
    });
});
