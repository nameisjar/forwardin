import { expect } from 'chai';
import {
    extractTrustedContactToken,
    OutboundPrivacyGuardError,
} from '../services/outboundPrivacyGuard';

describe('Outbound privacy guard', () => {
    it('extracts a trusted-contact token returned by WhatsApp', () => {
        const parsed = extractTrustedContactToken({
            tag: 'iq',
            attrs: {},
            content: [
                {
                    tag: 'tokens',
                    attrs: {},
                    content: [
                        {
                            tag: 'token',
                            attrs: {
                                type: 'trusted_contact',
                                t: '1786500000',
                            },
                            content: Buffer.from([1, 2, 3, 4]),
                        },
                    ],
                },
            ],
        });

        expect(parsed?.timestamp).to.equal('1786500000');
        expect(parsed?.token.equals(Buffer.from([1, 2, 3, 4]))).to.equal(true);
    });

    it('rejects malformed or unrelated token responses', () => {
        expect(extractTrustedContactToken({ tag: 'iq', attrs: {}, content: [] })).to.equal(null);
        expect(
            extractTrustedContactToken({
                tag: 'iq',
                attrs: {},
                content: [
                    {
                        tag: 'tokens',
                        attrs: {},
                        content: [
                            {
                                tag: 'token',
                                attrs: { type: 'other', t: '1786500000' },
                                content: Buffer.from([1]),
                            },
                        ],
                    },
                ],
            }),
        ).to.equal(null);
    });

    it('marks controlled privacy failures with HTTP 423 metadata', () => {
        const error = new OutboundPrivacyGuardError(
            'PRIVACY_TOKEN_UNAVAILABLE',
            'Token tidak tersedia',
        );

        expect(error.statusCode).to.equal(423);
        expect(error.code).to.equal('PRIVACY_TOKEN_UNAVAILABLE');
        expect(error.message).to.equal('Token tidak tersedia');
    });
});
