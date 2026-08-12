import { expect } from 'chai';
import { resolveCanonicalOutboundJid } from '../services/messageSender';

describe('Message sender canonical routing', () => {
    it('uses the stored LID mapping for a personal PN JID', async () => {
        const session = {
            signalRepository: {
                lidMapping: {
                    getLIDForPN: async (jid: string) => {
                        expect(jid).to.equal('628123456789@s.whatsapp.net');
                        return '123456789012345@lid';
                    },
                },
            },
        };

        const result = await resolveCanonicalOutboundJid(
            session,
            '628123456789@s.whatsapp.net',
        );

        expect(result).to.equal('123456789012345@lid');
    });

    it('keeps group and disabled protocol-action JIDs unchanged', async () => {
        const session = {
            signalRepository: {
                lidMapping: {
                    getLIDForPN: async () => {
                        throw new Error('must not be called');
                    },
                },
            },
        };

        expect(await resolveCanonicalOutboundJid(session, '12345@g.us')).to.equal(
            '12345@g.us',
        );
        expect(
            await resolveCanonicalOutboundJid(
                session,
                '628123456789@s.whatsapp.net',
                false,
            ),
        ).to.equal('628123456789@s.whatsapp.net');
    });

    it('falls back to PN when no valid LID mapping exists', async () => {
        const session = {
            signalRepository: {
                lidMapping: {
                    getLIDForPN: async () => null,
                },
            },
        };

        expect(
            await resolveCanonicalOutboundJid(session, '628123456789@s.whatsapp.net'),
        ).to.equal('628123456789@s.whatsapp.net');
    });
});
