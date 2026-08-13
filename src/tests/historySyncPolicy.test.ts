import { expect } from 'chai';
import { proto } from '@whiskeysockets/baileys';
import { shouldProcessHistorySync } from '../utils/historySyncPolicy';

describe('WhatsApp history sync policy', () => {
    it('rejects full chat history imports', () => {
        expect(
            shouldProcessHistorySync({
                syncType: proto.Message.HistorySyncType.FULL,
            }),
        ).to.equal(false);
    });

    it('allows bootstrap history needed by the signal repository', () => {
        expect(
            shouldProcessHistorySync({
                syncType: proto.Message.HistorySyncType.INITIAL_BOOTSTRAP,
            }),
        ).to.equal(true);
        expect(
            shouldProcessHistorySync({
                syncType: proto.Message.HistorySyncType.RECENT,
            }),
        ).to.equal(true);
    });
});
