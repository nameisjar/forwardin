import {
    aesDecryptGCM,
    hmacSign,
    jidNormalizedUser,
    proto,
} from '@whiskeysockets/baileys';
import { extractSupportedMessageText } from './messageEdit';

const MESSAGE_EDIT_INFO = 'Message Edit';

const normalizeCandidate = (jid: string | null | undefined) => {
    const value = String(jid || '').trim();
    return value ? jidNormalizedUser(value) : null;
};

const uniqueJids = (jids: Array<string | null | undefined>) =>
    Array.from(new Set(jids.map(normalizeCandidate).filter((jid): jid is string => Boolean(jid))));

export function isSecretMessageEditEnvelope(content: proto.IMessage | null | undefined) {
    return content?.secretEncryptedMessage?.secretEncType
        === proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT;
}

export function decryptSecretMessageEdit(input: {
    content: proto.IMessage | null | undefined;
    originalSecret: Uint8Array;
    originalSenderCandidates: Array<string | null | undefined>;
    modificationSenderCandidates: Array<string | null | undefined>;
    editedAt: Date;
}) {
    const encrypted = input.content?.secretEncryptedMessage;
    const targetMessageId = encrypted?.targetMessageKey?.id;
    if (
        !encrypted
        || encrypted.secretEncType
            !== proto.Message.SecretEncryptedMessage.SecretEncType.MESSAGE_EDIT
        || !targetMessageId
        || !encrypted.encPayload?.length
        || !encrypted.encIv?.length
    ) return null;

    // Only the original author can edit a message. Recent clients may use
    // either their LID or PN identity, but the chosen identity is used for
    // both sender fields in the key derivation.
    const authorCandidates = uniqueJids([
        ...input.modificationSenderCandidates,
        ...input.originalSenderCandidates,
    ]);
    for (const authorJid of authorCandidates) {
        try {
                const sign = Buffer.concat([
                    Buffer.from(targetMessageId, 'utf8'),
                    Buffer.from(authorJid, 'utf8'),
                    Buffer.from(authorJid, 'utf8'),
                    Buffer.from(MESSAGE_EDIT_INFO, 'utf8'),
                    new Uint8Array([1]),
                ]);
                const key0 = hmacSign(
                    Buffer.from(input.originalSecret),
                    new Uint8Array(32),
                    'sha256',
                );
                const key = hmacSign(sign, key0, 'sha256');
                const plaintext = aesDecryptGCM(
                    Buffer.from(encrypted.encPayload),
                    key,
                    Buffer.from(encrypted.encIv),
                    Buffer.alloc(0),
                );
                const decoded = proto.Message.decode(plaintext);
                const protocolMessage = decoded.protocolMessage;
                const isProtocolEdit = protocolMessage?.type
                    === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;
                const editedContent = isProtocolEdit
                    ? protocolMessage?.editedMessage
                    : decoded;
                const text = extractSupportedMessageText(editedContent);
                if (text === null) continue;
                return {
                    targetMessageId: isProtocolEdit
                        ? protocolMessage?.key?.id || targetMessageId
                        : targetMessageId,
                    text,
                    editedAt: isProtocolEdit && protocolMessage?.timestampMs
                        ? new Date(Number(protocolMessage.timestampMs))
                        : input.editedAt,
                    originalSender: authorJid,
                    modificationSender: authorJid,
                };
        } catch {
            // LID/PN migrations mean either author representation can be
            // used in the HMAC input. Try the next stored candidate.
        }
    }
    return null;
}
