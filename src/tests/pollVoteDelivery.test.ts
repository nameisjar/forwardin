import { expect } from 'chai';
import {
    rejectPendingPollVote,
    waitForPollVoteDelivery,
} from '../services/pollVoteDelivery';

describe('poll vote delivery guard', () => {
    it('returns the WhatsApp failure code received inside the rejection window', async () => {
        const pending = waitForPollVoteDelivery('POLL-VOTE-REJECTED', 100);

        expect(rejectPendingPollVote('POLL-VOTE-REJECTED', '479')).to.equal(true);
        expect(await pending.result).to.equal('479');
    });

    it('allows persistence when no rejection arrives inside the window', async () => {
        const pending = waitForPollVoteDelivery('POLL-VOTE-ACCEPTED', 10);

        expect(await pending.result).to.equal(null);
        expect(rejectPendingPollVote('POLL-VOTE-ACCEPTED', '479')).to.equal(false);
    });
});
