import { expect } from 'chai';
import {
    historyStatusCounts,
    inferHistorySource,
    isHistoryGroup,
    normalizeHistoryPhone,
} from '../controllers/tutor';

describe('sent history normalization', () => {
    it('identifies inbox and broadcast sources deterministically', () => {
        expect(inferHistorySource({ broadcastType: 'inbox' })).to.equal('inbox');
        expect(inferHistorySource({ sourceType: 'feedback' })).to.equal('feedback');
        expect(inferHistorySource({ id: 'BC_12_ABC' })).to.equal('broadcast');
        expect(inferHistorySource({ id: '3EB0123456789012345678' })).to.equal('inbox');
    });

    it('does not mistake a raw personal phone number for a group', () => {
        expect(isHistoryGroup({ to: '628123456789' })).to.equal(false);
        expect(isHistoryGroup({ to: '120363000000@g.us' })).to.equal(true);
        expect(isHistoryGroup({ to: '628123456789@s.whatsapp.net', isGroup: false })).to.equal(
            false,
        );
    });

    it('normalizes WhatsApp phone addressing consistently', () => {
        expect(normalizeHistoryPhone('+62 812-3456-789@s.whatsapp.net')).to.equal(
            '628123456789',
        );
    });

    it('counts all statuses in mutually exclusive summary buckets', () => {
        expect(
            historyStatusCounts([
                { status: 'delivery_ack' },
                { status: 'read' },
                { status: 'played' },
                { status: 'error' },
                { status: 'pending' },
                { status: 'server_ack' },
            ]),
        ).to.deep.equal({ total: 6, delivered: 3, failed: 1, processing: 2 });
    });
});
