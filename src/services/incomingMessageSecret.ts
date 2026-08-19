import type { proto, WAMessageKey } from '@whiskeysockets/baileys';
import prisma from '../utils/db';
import logger from '../config/logger';
import { decrypt, encrypt } from '../utils/encryption';
import {
    decryptSecretMessageEdit,
    isSecretMessageEditEnvelope,
} from '../utils/secretMessageEdit';
import { applyIncomingMessageEdit } from './incomingMessageEdit';

const editTimestamp = (value: unknown) => {
    const seconds = Number(value);
    return Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000)
        : new Date();
};

const senderJidsFromKey = (key: WAMessageKey) => {
    const primary = key.participant || key.remoteJid;
    const alternate = key.participantAlt || key.remoteJidAlt;
    return { primary, alternate };
};

export async function saveIncomingMessageSecret(input: {
    messageId: string;
    deviceId: number;
    sessionId: string;
    key: WAMessageKey;
    content: proto.IMessage | null | undefined;
}) {
    const secret = input.content?.messageContextInfo?.messageSecret;
    if (!secret?.length) return false;
    const sender = senderJidsFromKey(input.key);
    if (!sender.primary) return false;

    await prisma.incomingMessageSecret.upsert({
        where: { messageId: input.messageId },
        create: {
            messageId: input.messageId,
            deviceId: input.deviceId,
            sessionId: input.sessionId,
            senderJid: sender.primary,
            senderAltJid: sender.alternate || null,
            encryptedSecret: encrypt(Buffer.from(secret).toString('base64')),
        },
        update: {
            senderJid: sender.primary,
            senderAltJid: sender.alternate || null,
            encryptedSecret: encrypt(Buffer.from(secret).toString('base64')),
        },
    });
    return true;
}

export async function applySecretIncomingMessageEdit(input: {
    sessionId: string;
    deviceId: number;
    key: WAMessageKey;
    content: proto.IMessage | null | undefined;
    messageTimestamp?: unknown;
}) {
    if (!isSecretMessageEditEnvelope(input.content)) return false;
    const encrypted = input.content?.secretEncryptedMessage;
    const targetMessageId = encrypted?.targetMessageKey?.id;
    if (!targetMessageId) return true;

    const stored = await prisma.incomingMessageSecret.findFirst({
        where: {
            messageId: targetMessageId,
            OR: [
                { deviceId: input.deviceId },
                { sessionId: input.sessionId },
            ],
        },
    });
    if (!stored) {
        logger.warn(
            { sessionId: input.sessionId, messageId: targetMessageId },
            'Cannot decrypt message edit because original message secret is unavailable',
        );
        return true;
    }

    const modificationSender = senderJidsFromKey(input.key);
    const targetKey = encrypted?.targetMessageKey;
    const parsed = decryptSecretMessageEdit({
        content: input.content,
        originalSecret: Buffer.from(decrypt(stored.encryptedSecret), 'base64'),
        originalSenderCandidates: [
            targetKey?.participant,
            targetKey?.remoteJid,
            stored.senderJid,
            stored.senderAltJid,
        ],
        modificationSenderCandidates: [
            modificationSender.primary,
            modificationSender.alternate,
        ],
        editedAt: editTimestamp(input.messageTimestamp),
    });
    if (!parsed) {
        logger.warn(
            { sessionId: input.sessionId, messageId: targetMessageId },
            'Failed to decrypt secret-encrypted WhatsApp message edit',
        );
        return true;
    }

    await applyIncomingMessageEdit({
        sessionId: input.sessionId,
        deviceId: input.deviceId,
        messageId: parsed.targetMessageId,
        text: parsed.text,
        editedAt: parsed.editedAt,
        remoteJid: input.key.remoteJid,
    });
    return true;
}
