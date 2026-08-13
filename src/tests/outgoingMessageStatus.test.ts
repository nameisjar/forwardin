import { expect } from 'chai';
import {
    canApplyOutgoingMessageStatus,
    eligibleOutgoingMessageStatuses,
    isTerminalOutgoingMessageStatus,
} from '../utils/outgoingMessageStatus';

describe('Outgoing message status transitions', () => {
    it('advances successful acknowledgements monotonically', () => {
        expect(canApplyOutgoingMessageStatus('pending', 'server_ack')).to.equal(true);
        expect(canApplyOutgoingMessageStatus('server_ack', 'delivery_ack')).to.equal(true);
        expect(canApplyOutgoingMessageStatus('delivery_ack', 'read')).to.equal(true);
        expect(canApplyOutgoingMessageStatus('read', 'played')).to.equal(true);

        expect(canApplyOutgoingMessageStatus('read', 'delivery_ack')).to.equal(false);
        expect(canApplyOutgoingMessageStatus('played', 'read')).to.equal(false);
        expect(canApplyOutgoingMessageStatus('server_ack', 'server_ack')).to.equal(false);
    });

    it('treats error and failed as terminal', () => {
        for (const terminal of ['error', 'failed']) {
            expect(isTerminalOutgoingMessageStatus(terminal)).to.equal(true);
            for (const later of ['pending', 'server_ack', 'delivery_ack', 'read', 'played']) {
                expect(canApplyOutgoingMessageStatus(terminal, later)).to.equal(false);
            }
        }
    });

    it('allows an explicit NACK only before delivery', () => {
        expect(canApplyOutgoingMessageStatus('pending', 'error')).to.equal(true);
        expect(canApplyOutgoingMessageStatus('server_ack', 'error')).to.equal(true);
        expect(canApplyOutgoingMessageStatus('delivery_ack', 'error')).to.equal(false);
        expect(canApplyOutgoingMessageStatus('read', 'error')).to.equal(false);
        expect(canApplyOutgoingMessageStatus('played', 'error')).to.equal(false);
    });

    it('builds atomic filters that never include terminal states', () => {
        expect(eligibleOutgoingMessageStatuses('server_ack')).to.deep.equal(['pending']);
        expect(eligibleOutgoingMessageStatuses('delivery_ack')).to.deep.equal([
            'pending',
            'server_ack',
        ]);
        expect(eligibleOutgoingMessageStatuses('read')).to.deep.equal([
            'pending',
            'server_ack',
            'delivery_ack',
        ]);
        expect(eligibleOutgoingMessageStatuses('error')).to.deep.equal([
            'pending',
            'server_ack',
        ]);
    });
});
