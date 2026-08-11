import { expect } from 'chai';
import {
    deriveDeviceRuntimeStatus,
    getReconnectDelay,
    normalizeConnectionUpdate,
} from '../utils/connectionPolicy';

describe('WhatsApp connection policy', () => {
    it('ignores partial connection updates without an explicit status', () => {
        expect(normalizeConnectionUpdate(undefined)).to.equal(null);
        expect(normalizeConnectionUpdate(null)).to.equal(null);
        expect(normalizeConnectionUpdate('')).to.equal(null);
    });

    it('normalizes known connection states', () => {
        expect(normalizeConnectionUpdate('open')).to.equal('open');
        expect(normalizeConnectionUpdate('closed')).to.equal('close');
        expect(normalizeConnectionUpdate('reconnecting')).to.equal('reconnecting');
    });

    it('uses runtime state instead of a stale database status', () => {
        expect(deriveDeviceRuntimeStatus({
            databaseStatus: 'close',
            hasSession: true,
            hasInstance: true,
            connection: 'open',
        })).to.equal('open');

        expect(deriveDeviceRuntimeStatus({
            databaseStatus: 'open',
            hasSession: false,
            hasInstance: false,
        })).to.equal('close');
    });

    it('exposes reconnecting as a distinct state', () => {
        expect(deriveDeviceRuntimeStatus({
            databaseStatus: 'close',
            hasSession: true,
            hasInstance: true,
            connection: 'close',
            reconnecting: true,
        })).to.equal('reconnecting');
    });

    it('backs off reconnect attempts and caps the delay', () => {
        expect(getReconnectDelay(1, 2000, 60000)).to.equal(2000);
        expect(getReconnectDelay(2, 2000, 60000)).to.equal(4000);
        expect(getReconnectDelay(10, 2000, 60000)).to.equal(60000);
    });
});
