import { expect } from 'chai';
import {
    decryptMessage,
    encryptMessage,
    isCurrentMessageEncrypted,
    validateMessageEncryptionSetup,
} from '../utils/messageEncryption';

describe('message encryption hardening', () => {
    const originalEnv = {
        NODE_ENV: process.env.NODE_ENV,
        MESSAGE_ENCRYPTION_ENABLED: process.env.MESSAGE_ENCRYPTION_ENABLED,
        MESSAGE_ENCRYPTION_KEY: process.env.MESSAGE_ENCRYPTION_KEY,
        MESSAGE_ENCRYPTION_KEY_ID: process.env.MESSAGE_ENCRYPTION_KEY_ID,
        MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON: process.env.MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON,
        SESSION_ENCRYPTION_KEY: process.env.SESSION_ENCRYPTION_KEY,
    };

    const restore = (name: keyof typeof originalEnv) => {
        const value = originalEnv[name];
        if (value === undefined) delete process.env[name];
        else process.env[name] = value;
    };

    beforeEach(() => {
        restore('SESSION_ENCRYPTION_KEY');
        process.env.NODE_ENV = 'test';
        process.env.MESSAGE_ENCRYPTION_ENABLED = 'true';
        process.env.MESSAGE_ENCRYPTION_KEY = '11'.repeat(32);
        process.env.MESSAGE_ENCRYPTION_KEY_ID = 'test-key';
        delete process.env.MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON;
    });

    after(() => {
        Object.keys(originalEnv).forEach((name) => restore(name as keyof typeof originalEnv));
    });

    it('encrypts messages with authenticated encryption and decrypts them', () => {
        const encrypted = encryptMessage('pesan rahasia');

        expect(encrypted).to.be.a('string').and.not.equal('pesan rahasia');
        expect(isCurrentMessageEncrypted(encrypted)).to.equal(true);
        expect(decryptMessage(encrypted)).to.equal('pesan rahasia');
    });

    it('uses a fresh IV for every message', () => {
        expect(encryptMessage('pesan sama')).not.to.equal(encryptMessage('pesan sama'));
    });

    it('rejects modified ciphertext', () => {
        const encrypted = encryptMessage('pesan rahasia') as string;
        const tampered = encrypted.slice(0, -1) + (encrypted.endsWith('0') ? '1' : '0');

        expect(() => decryptMessage(tampered)).to.throw('Failed to decrypt message content');
    });

    it('reads ciphertext created with a previous key after rotation', () => {
        const encrypted = encryptMessage('sebelum rotasi') as string;
        process.env.MESSAGE_ENCRYPTION_KEY = '22'.repeat(32);
        process.env.MESSAGE_ENCRYPTION_KEY_ID = 'next-key';
        process.env.MESSAGE_ENCRYPTION_PREVIOUS_KEYS_JSON = JSON.stringify({
            'test-key': '11'.repeat(32),
        });

        expect(decryptMessage(encrypted)).to.equal('sebelum rotasi');
    });

    it('keeps local derived ciphertext readable after a dedicated key is added', () => {
        delete process.env.MESSAGE_ENCRYPTION_KEY;
        delete process.env.MESSAGE_ENCRYPTION_KEY_ID;
        process.env.SESSION_ENCRYPTION_KEY = '33'.repeat(32);
        const encrypted = encryptMessage('masa transisi') as string;

        process.env.MESSAGE_ENCRYPTION_KEY = '44'.repeat(32);
        process.env.MESSAGE_ENCRYPTION_KEY_ID = 'dedicated';

        expect(decryptMessage(encrypted)).to.equal('masa transisi');
    });

    it('fails closed in production when the message key is missing', () => {
        process.env.NODE_ENV = 'production';
        process.env.MESSAGE_ENCRYPTION_ENABLED = 'true';
        delete process.env.MESSAGE_ENCRYPTION_KEY;

        expect(validateMessageEncryptionSetup().valid).to.equal(false);
        expect(() => encryptMessage('jangan simpan plaintext')).to.throw(
            'MESSAGE_ENCRYPTION_KEY is required',
        );
    });
});
