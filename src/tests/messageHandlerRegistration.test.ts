import { expect } from 'chai';
import type { BaileysEventEmitter } from '@whiskeysockets/baileys';
import messageHandler from '../whatsappControllers/message';

describe('Inbox message handler registration', () => {
    it('leaves ACK/NACK messages.update to the generation-aware socket listener', () => {
        const registered: string[] = [];
        const removed: string[] = [];
        const event = {
            on: (name: string) => {
                registered.push(name);
                return event;
            },
            off: (name: string) => {
                removed.push(name);
                return event;
            },
        } as unknown as BaileysEventEmitter;

        const handler = messageHandler('session-under-test', event, 42);
        handler.listen();

        expect(registered).to.include('messages.upsert');
        expect(registered).to.include('message-receipt.update');
        expect(registered).not.to.include('messages.update');

        handler.unlisten();
        expect(removed).to.include('messages.upsert');
        expect(removed).to.include('message-receipt.update');
        expect(removed).not.to.include('messages.update');
    });
});

