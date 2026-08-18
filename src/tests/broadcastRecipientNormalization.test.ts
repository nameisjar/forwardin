import { expect } from 'chai';
import {
    getRecipientVerificationFailureStatus,
    normalizeBroadcastRecipient,
    resolveScheduledGroupRecipient,
} from '../utils/recipients';

describe('Broadcast recipient normalization', () => {
    it('normalizes Indonesian local and formatted numbers', () => {
        expect(normalizeBroadcastRecipient('0812-3456-7890')).to.deep.equal({
            jid: '6281234567890@s.whatsapp.net',
            type: 'number',
        });
        expect(normalizeBroadcastRecipient('+62 (812) 3456-7890')).to.deep.equal({
            jid: '6281234567890@s.whatsapp.net',
            type: 'number',
        });
    });

    it('preserves valid international, group, and LID addressing', () => {
        expect(normalizeBroadcastRecipient('+1 202 555 0100')).to.deep.equal({
            jid: '12025550100@s.whatsapp.net',
            type: 'number',
        });
        expect(normalizeBroadcastRecipient('120363012345678901-1234567890')).to.deep.equal({
            jid: '120363012345678901-1234567890@g.us',
            type: 'group',
        });
        expect(normalizeBroadcastRecipient('120363012345678901@g.us')).to.deep.equal({
            jid: '120363012345678901@g.us',
            type: 'group',
        });
        expect(normalizeBroadcastRecipient('120363012345678901-1234567890@G.US')).to.deep.equal({
            jid: '120363012345678901-1234567890@g.us',
            type: 'group',
        });
        expect(normalizeBroadcastRecipient('987654321@LID')).to.deep.equal({
            jid: '987654321@lid',
            type: 'number',
        });
    });

    it('rejects malformed or unsupported recipients before send', () => {
        for (const recipient of [
            '',
            '123',
            'not-a-number',
            'phone628123456789',
            '123@example.com',
            '120363abc123456789@g.us',
            '120363012345678901--1234567890@g.us',
            '120363012345678901-abc@g.us',
        ]) {
            expect(() => normalizeBroadcastRecipient(recipient)).to.throw();
        }
    });

    it('rebinds an inactive group JID to the unique active group on the live session', () => {
        expect(
            resolveScheduledGroupRecipient('120363012345678901-1111111111@g.us', 'session-new', [
                {
                    groupId: '120363012345678901-1111111111@g.us',
                    groupName: 'Kelas ABC',
                    isActive: false,
                    sessionId: 'session-old',
                },
                {
                    groupId: '120363099999999999-2222222222@g.us',
                    groupName: 'Kelas ABC',
                    isActive: true,
                    sessionId: 'session-new',
                },
            ]),
        ).to.equal('120363099999999999-2222222222@g.us');
    });

    it('keeps the original group JID when the replacement would be ambiguous', () => {
        const original = '120363012345678901-1111111111@g.us';
        expect(
            resolveScheduledGroupRecipient(original, 'session-new', [
                {
                    groupId: original,
                    groupName: 'Kelas ABC',
                    isActive: false,
                    sessionId: 'session-old',
                },
                {
                    groupId: '120363099999999999-2222222222@g.us',
                    groupName: 'Kelas ABC',
                    isActive: true,
                    sessionId: 'session-new',
                },
                {
                    groupId: '120363088888888888-3333333333@g.us',
                    groupName: 'Kelas ABC',
                    isActive: true,
                    sessionId: 'session-new',
                },
            ]),
        ).to.equal(original);
    });

    it('only retries verification failures for normalized group recipients', () => {
        expect(
            getRecipientVerificationFailureStatus({
                jid: '120363012345678901-1111111111@g.us',
                type: 'group',
            }),
        ).to.equal('failed');
        expect(
            getRecipientVerificationFailureStatus({
                jid: '6281234567890@s.whatsapp.net',
                type: 'number',
            }),
        ).to.equal('invalid');
        expect(getRecipientVerificationFailureStatus()).to.equal('invalid');
    });
});
