import { expect } from 'chai';

// The production patcher is deliberately CommonJS so npm can run it before
// TypeScript is compiled.
/* eslint-disable @typescript-eslint/no-var-requires */
const {
    PATCH_MARKER,
    VULNERABLE_BLOCK,
    transformMessagesRecvSource,
} = require('../../scripts/patch-baileys-tctoken');
/* eslint-enable @typescript-eslint/no-var-requires */

describe('Baileys trusted-contact token patch', () => {
    it('replaces sender_lid-first storage with canonical peer validation', () => {
        const fixture = `before\n${VULNERABLE_BLOCK}\nafter`;
        const result = transformMessagesRecvSource(fixture);

        expect(result.changed).to.equal(true);
        expect(result.source).to.include(PATCH_MARKER);
        expect(result.source).to.include('const resolvedFrom = await resolveTcTokenJid');
        expect(result.source).to.include('getPNForLID(senderLid)');
        expect(result.source).not.to.include(
            'const fallbackJid = senderLid ?? (await resolveTcTokenJid',
        );
    });

    it('is idempotent after the patch marker is present', () => {
        const first = transformMessagesRecvSource(VULNERABLE_BLOCK);
        const second = transformMessagesRecvSource(first.source);

        expect(second.changed).to.equal(false);
        expect(second.source).to.equal(first.source);
    });

    it('fails closed when the pinned dependency source changes', () => {
        expect(() => transformMessagesRecvSource('unknown upstream implementation')).to.throw(
            'does not match the pinned rc14 source',
        );
    });
});
