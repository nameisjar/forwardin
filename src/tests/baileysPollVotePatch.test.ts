import { expect } from 'chai';

// The production patcher is deliberately CommonJS so npm can execute it
// before TypeScript is compiled.
/* eslint-disable @typescript-eslint/no-var-requires */
const {
    PATCH_MARKER,
    VULNERABLE_BLOCK,
    transformMessagesSendSource,
} = require('../../scripts/patch-baileys-poll-vote');
/* eslint-enable @typescript-eslint/no-var-requires */

describe('Baileys poll vote sender patch', () => {
    it('adds decrypt-fail=hide handling for poll updates', () => {
        const result = transformMessagesSendSource(VULNERABLE_BLOCK);

        expect(result.changed).to.equal(true);
        expect(result.source).to.include(PATCH_MARKER);
        expect(result.source).to.include('pollUpdateMessage');
        expect(result.source).to.include("extraAttrs['decrypt-fail'] = 'hide'");
    });

    it('is idempotent', () => {
        const first = transformMessagesSendSource(VULNERABLE_BLOCK);
        const second = transformMessagesSendSource(first.source);

        expect(second.changed).to.equal(false);
        expect(second.source).to.equal(first.source);
    });

    it('fails closed when the pinned upstream source changes', () => {
        expect(() => transformMessagesSendSource('unknown upstream implementation')).to.throw(
            'does not match the pinned rc14 source',
        );
    });
});
