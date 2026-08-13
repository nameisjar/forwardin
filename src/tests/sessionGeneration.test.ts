import { expect } from 'chai';
import { SessionGenerationRegistry } from '../utils/sessionGeneration';

describe('WhatsApp session generation registry', () => {
    it('invalidates callbacks from a replaced socket', () => {
        const registry = new SessionGenerationRegistry();
        const first = registry.begin('session-a');
        const replacement = registry.begin('session-a');

        expect(registry.isCurrent('session-a', first)).to.equal(false);
        expect(registry.isCurrent('session-a', replacement)).to.equal(true);
    });

    it('does not let stale cleanup clear the replacement generation', () => {
        const registry = new SessionGenerationRegistry();
        const first = registry.begin('session-a');
        const replacement = registry.begin('session-a');

        expect(registry.clear('session-a', first)).to.equal(false);
        expect(registry.isCurrent('session-a', replacement)).to.equal(true);
        expect(registry.clear('session-a', replacement)).to.equal(true);
        expect(registry.isCurrent('session-a', replacement)).to.equal(false);
    });

    it('never reuses a generation after a session is cleared', () => {
        const registry = new SessionGenerationRegistry();
        const first = registry.begin('session-a');
        registry.clear('session-a', first);
        const recreated = registry.begin('session-a');

        expect(recreated).to.be.greaterThan(first);
    });
});
