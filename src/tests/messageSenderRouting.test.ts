import { expect } from 'chai';
import {
    resolveCanonicalOutboundJid,
    shouldUseCanonicalOutboundRouting,
} from '../services/messageSender';

describe('Message sender canonical routing', () => {
    it('uses the stored canonical LID for a new personal PN message', async () => {
        const requestedJids: string[] = [];
        const session = {
            signalRepository: {
                lidMapping: {
                    getLIDForPN: async (jid: string) => {
                        requestedJids.push(jid);
                        return '987654321@lid';
                    },
                },
            },
        };

        const result = await resolveCanonicalOutboundJid(
            session,
            '628123456789@s.whatsapp.net',
        );

        expect(result).to.equal('987654321@lid');
        expect(requestedJids).to.deep.equal(['628123456789@s.whatsapp.net']);
    });

    it('supports the hosted PN to hosted LID mapping', async () => {
        const session = {
            signalRepository: {
                lidMapping: {
                    getLIDForPN: async () => '987654321@hosted.lid',
                },
            },
        };

        expect(await resolveCanonicalOutboundJid(session, '628123456789@hosted'))
            .to.equal('987654321@hosted.lid');
    });

    it('does not look up groups, newsletters, or an existing LID', async () => {
        let lookupCount = 0;
        const session = {
            signalRepository: {
                lidMapping: {
                    getLIDForPN: async () => {
                        lookupCount += 1;
                        return '987654321@lid';
                    },
                },
            },
        };
        const unchangedJids = [
            '120363000000000000@g.us',
            '120363000000000000@newsletter',
            '987654321@lid',
            '987654321@hosted.lid',
        ];

        for (const jid of unchangedJids) {
            expect(await resolveCanonicalOutboundJid(session, jid)).to.equal(jid);
        }
        expect(lookupCount).to.equal(0);
    });

    it('keeps the original PN when lookup is disabled, unavailable, or invalid', async () => {
        const pn = '628123456789@s.whatsapp.net';
        const invalidMappings: unknown[] = [
            undefined,
            null,
            '',
            '@lid',
            '987654321@s.whatsapp.net',
            '987654321@newsletter',
            '987654321@lid extra',
        ];

        expect(await resolveCanonicalOutboundJid({}, pn, false)).to.equal(pn);
        expect(await resolveCanonicalOutboundJid({}, pn)).to.equal(pn);

        for (const mappedJid of invalidMappings) {
            const session = {
                signalRepository: {
                    lidMapping: {
                        getLIDForPN: async () => mappedJid,
                    },
                },
            };
            expect(await resolveCanonicalOutboundJid(session, pn)).to.equal(pn);
        }
    });

    it('falls back to the original PN when the LID lookup throws', async () => {
        const pn = '628123456789@s.whatsapp.net';
        const session = {
            signalRepository: {
                lidMapping: {
                    getLIDForPN: async () => {
                        throw new Error('mapping unavailable');
                    },
                },
            },
        };

        expect(await resolveCanonicalOutboundJid(session, pn)).to.equal(pn);
    });

    it('enables canonical routing by default only for new personal messages', () => {
        expect(shouldUseCanonicalOutboundRouting('628123456789@s.whatsapp.net'))
            .to.equal(true);
        expect(shouldUseCanonicalOutboundRouting('628123456789@hosted'))
            .to.equal(true);
        expect(shouldUseCanonicalOutboundRouting('120363000000000000@g.us'))
            .to.equal(false);
        expect(shouldUseCanonicalOutboundRouting('120363000000000000@newsletter'))
            .to.equal(false);
        expect(shouldUseCanonicalOutboundRouting('987654321@lid'))
            .to.equal(false);
    });

    it('keeps quoted sends and explicit opt-outs on their original JID', () => {
        const pn = '628123456789@s.whatsapp.net';

        expect(shouldUseCanonicalOutboundRouting(pn, { resolveToLid: false }))
            .to.equal(false);
        expect(shouldUseCanonicalOutboundRouting(pn, {
            quoted: { key: { id: 'quoted-message' } },
        })).to.equal(false);
    });

    it('keeps address-bound protocol actions on their original JID', () => {
        const pn = '628123456789@s.whatsapp.net';
        const protocolContents = [
            { react: {} },
            { delete: {} },
            { edit: {} },
            { pin: {} },
            { keepInChat: {} },
            { protocolMessage: {} },
            { disappearingMessagesInChat: false },
            { limitSharing: false },
            { sharePhoneNumber: false },
        ];

        for (const content of protocolContents) {
            expect(shouldUseCanonicalOutboundRouting(pn, undefined, content))
                .to.equal(false);
        }
    });
});
