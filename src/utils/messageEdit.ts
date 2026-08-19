import {
    extractMessageContent,
    normalizeMessageContent,
    proto,
} from '@whiskeysockets/baileys';

type MessageUpdateLike = {
    message?: proto.IMessage | null;
    messageTimestamp?: unknown;
};

export type ParsedMessageEdit = {
    targetMessageId: string;
    text: string;
    editedAt: Date;
};

const nestedMessage = (
    content: proto.IMessage | null | undefined,
): proto.IMessage | null | undefined =>
    content?.ephemeralMessage?.message
    || content?.viewOnceMessage?.message
    || content?.viewOnceMessageV2?.message
    || content?.viewOnceMessageV2Extension?.message
    || content?.documentWithCaptionMessage?.message
    || content?.associatedChildMessage?.message
    || content?.groupStatusMessage?.message
    || content?.groupStatusMessageV2?.message
    || content?.editedMessage?.message
    || null;

const findEditedMessageWrapper = (content: unknown): proto.IMessage | null => {
    let current = content as proto.IMessage | null | undefined;
    for (let depth = 0; current && depth < 8; depth += 1) {
        if (current.editedMessage?.message) {
            return current.editedMessage.message as proto.IMessage;
        }
        current = nestedMessage(current);
    }
    return null;
};

const dateFromTimestamp = (value: unknown, milliseconds = false): Date => {
    const numeric = Number(value);
    if (!Number.isFinite(numeric) || numeric <= 0) return new Date();
    return new Date(milliseconds ? numeric : numeric * 1000);
};

export function isMessageEditEnvelope(content: unknown): boolean {
    const normalized = normalizeMessageContent(content as proto.IMessage | null | undefined);
    return normalized?.protocolMessage?.type
        === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
        || Boolean(findEditedMessageWrapper(content));
}

export function extractSupportedMessageText(content: proto.IMessage | null | undefined): string | null {
    const normalized = extractMessageContent(content);
    if (!normalized) return null;

    if (typeof normalized.conversation === 'string') return normalized.conversation;
    if (typeof normalized.extendedTextMessage?.text === 'string') {
        return normalized.extendedTextMessage.text;
    }
    if (normalized.imageMessage) {
        return normalized.imageMessage.caption || '[Gambar]';
    }
    if (normalized.videoMessage) {
        return normalized.videoMessage.caption || '[Video]';
    }
    if (normalized.documentMessage) {
        return normalized.documentMessage.caption
            || normalized.documentMessage.fileName
            || '[Dokumen]';
    }
    if (normalized.audioMessage) return '[Audio]';
    if (normalized.stickerMessage) return '[Stiker]';
    return null;
}

export function extractMessageEdit(update: MessageUpdateLike | null | undefined): {
    text: string;
    editedAt: Date;
} | null {
    const editedContent = update?.message?.editedMessage?.message;
    if (!editedContent) return null;

    const text = extractSupportedMessageText(editedContent);
    if (text === null) return null;

    const seconds = Number(update?.messageTimestamp);
    const editedAt = Number.isFinite(seconds) && seconds > 0
        ? new Date(seconds * 1000)
        : new Date();
    return { text, editedAt };
}

/**
 * Parses an edit directly from messages.upsert. WhatsApp group edits can be
 * nested inside groupStatusMessage, while Baileys' event buffer can also fold
 * a messages.update event into an editedMessage wrapper whose key already
 * points at the original message.
 */
export function extractMessageEditEnvelope(
    content: proto.IMessage | null | undefined,
    fallbackMessageId: string | null | undefined,
    fallbackTimestamp?: unknown,
): ParsedMessageEdit | null {
    const normalized = normalizeMessageContent(content);
    const protocolMessage = normalized?.protocolMessage;
    if (
        protocolMessage?.type
        === proto.Message.ProtocolMessage.Type.MESSAGE_EDIT
    ) {
        const targetMessageId = protocolMessage.key?.id;
        const text = extractSupportedMessageText(protocolMessage.editedMessage);
        if (!targetMessageId || text === null) return null;
        return {
            targetMessageId,
            text,
            editedAt: protocolMessage.timestampMs
                ? dateFromTimestamp(protocolMessage.timestampMs, true)
                : dateFromTimestamp(fallbackTimestamp),
        };
    }

    const editedContent = findEditedMessageWrapper(content);
    const text = extractSupportedMessageText(editedContent);
    if (!fallbackMessageId || text === null) return null;
    return {
        targetMessageId: fallbackMessageId,
        text,
        editedAt: dateFromTimestamp(fallbackTimestamp),
    };
}
