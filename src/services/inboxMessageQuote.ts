import {
    extractMessageContent,
    jidNormalizedUser,
    proto,
    type WAMessage,
} from '@whiskeysockets/baileys';
import prisma from '../utils/db';
import { resolveInboxMediaType } from '../utils/inboxMedia';
import { decryptMessage } from '../utils/messageEncryption';
import { extractSupportedMessageText } from '../utils/messageEdit';

export type InboxReplyTarget = {
    targetMessageId: string;
    targetFromMe: boolean;
};

export type InboxQuoteMetadata = {
    quotedMessageId: string;
    quotedFromMe: boolean | null;
    quotedText: string;
    quotedSender: string | null;
};

export type ResolvedInboxReply = InboxQuoteMetadata & {
    deliveryJid: string;
    quoted: WAMessage;
};

const sameJid = (left: string | null | undefined, right: string | null | undefined) => {
    if (!left || !right) return false;
    return jidNormalizedUser(left) === jidNormalizedUser(right);
};

const senderLabel = (value: string | null | undefined) => {
    const text = String(value || '').trim();
    if (!text) return null;
    return text.split('@')[0].replace(/^\+/, '') || null;
};

const MEDIA_PLACEHOLDERS = new Set([
    '[gambar]',
    '[video]',
    '[audio]',
    '[stiker]',
    '[dokumen]',
]);

const extensionOf = (value: string | null | undefined) => {
    const normalized = String(value || '').split(/[?#]/)[0].replace(/\\/g, '/');
    const name = normalized.split('/').pop() || '';
    return name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
};

const mimeTypeFor = (
    mediaType: 'image' | 'video' | 'audio' | 'document',
    fileName: string | null | undefined,
    mediaPath: string | null | undefined,
) => {
    const dataMime = String(mediaPath || '').match(/^data:([^;,]+)/i)?.[1];
    if (dataMime) return dataMime;

    const extension = extensionOf(fileName) || extensionOf(mediaPath);
    const knownMimeTypes: Record<string, string> = {
        jpg: 'image/jpeg',
        jpeg: 'image/jpeg',
        png: 'image/png',
        gif: 'image/gif',
        webp: 'image/webp',
        mp4: 'video/mp4',
        mov: 'video/quicktime',
        webm: 'video/webm',
        mkv: 'video/x-matroska',
        mp3: 'audio/mpeg',
        ogg: 'audio/ogg',
        wav: 'audio/wav',
        m4a: 'audio/mp4',
        aac: 'audio/aac',
        opus: 'audio/ogg; codecs=opus',
        pdf: 'application/pdf',
        doc: 'application/msword',
        docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        xls: 'application/vnd.ms-excel',
        xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
        ppt: 'application/vnd.ms-powerpoint',
        pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
        txt: 'text/plain',
        csv: 'text/csv',
        zip: 'application/zip',
    };
    return knownMimeTypes[extension] || {
        image: 'image/jpeg',
        video: 'video/mp4',
        audio: 'audio/ogg; codecs=opus',
        document: 'application/octet-stream',
    }[mediaType];
};

/**
 * Build a minimal quoted payload with the same WhatsApp content type as the
 * original Inbox row. Baileys copies this object into contextInfo.quotedMessage;
 * treating every target as `conversation` makes replies to media invalid or
 * appear as replies to a generic text message on WhatsApp.
 */
export function buildInboxQuotedMessageContent(input: {
    text: string;
    mediaPath?: string | null;
    fileName?: string | null;
}): proto.IMessage {
    const normalizedText = String(input.text || '').trim();
    if (!input.mediaPath) return { conversation: normalizedText || '[Pesan]' };

    const placeholder = normalizedText.toLowerCase();
    if (placeholder === '[stiker]') {
        return { stickerMessage: { mimetype: 'image/webp' } };
    }

    const mediaType = resolveInboxMediaType(
        input.mediaPath,
        input.fileName,
        normalizedText,
    ) || 'document';
    const mimetype = mimeTypeFor(mediaType, input.fileName, input.mediaPath);
    const caption = normalizedText && !MEDIA_PLACEHOLDERS.has(placeholder)
        ? normalizedText
        : undefined;

    switch (mediaType) {
        case 'image':
            return { imageMessage: { mimetype, caption } };
        case 'video':
            return { videoMessage: { mimetype, caption } };
        case 'audio':
            return { audioMessage: { mimetype } };
        default:
            return {
                documentMessage: {
                    mimetype,
                    fileName: input.fileName || undefined,
                    title: input.fileName || undefined,
                    caption,
                },
            };
    }
}

const quoteContextInfo = (content: proto.IMessage | null | undefined) => {
    const normalized = extractMessageContent(content);
    return normalized?.extendedTextMessage?.contextInfo
        || normalized?.imageMessage?.contextInfo
        || normalized?.videoMessage?.contextInfo
        || normalized?.documentMessage?.contextInfo
        || normalized?.audioMessage?.contextInfo
        || normalized?.stickerMessage?.contextInfo
        || null;
};

export async function resolveInboxReplyTarget(input: {
    deviceId: number;
    sessionId: string;
    conversationJid: string;
    target: InboxReplyTarget;
}): Promise<ResolvedInboxReply> {
    const targetMessageId = String(input.target.targetMessageId || '').trim();
    if (!targetMessageId) throw new Error('ID pesan yang akan dibalas tidak valid');

    if (input.target.targetFromMe) {
        const target = await prisma.outgoingMessage.findFirst({
            where: {
                deviceId: input.deviceId,
                OR: [{ id: targetMessageId }, { waMessageId: targetMessageId }],
            },
            select: {
                id: true,
                waMessageId: true,
                to: true,
                message: true,
                mediaPath: true,
                fileName: true,
                createdAt: true,
            },
        });
        if (!target || !sameJid(target.to, input.conversationJid)) {
            throw new Error('Pesan yang akan dibalas tidak ditemukan pada percakapan ini');
        }

        const whatsappMessageId = target.waMessageId || target.id;
        const rawMessage = await prisma.message.findFirst({
            where: { sessionId: input.sessionId, id: whatsappMessageId },
            orderBy: { pkId: 'desc' },
            select: { remoteJid: true },
        });
        const deliveryJid = rawMessage?.remoteJid || target.to;
        const quotedText = decryptMessage(target.message) || '[Pesan]';
        return {
            quotedMessageId: whatsappMessageId,
            quotedFromMe: true,
            quotedText,
            quotedSender: 'Anda',
            deliveryJid,
            quoted: {
                key: {
                    remoteJid: deliveryJid,
                    id: whatsappMessageId,
                    fromMe: true,
                },
                message: buildInboxQuotedMessageContent({
                    text: quotedText,
                    mediaPath: target.mediaPath,
                    fileName: target.fileName,
                }),
                messageTimestamp: Math.floor(target.createdAt.getTime() / 1000),
            },
        };
    }

    const target = await prisma.incomingMessage.findFirst({
        where: {
            deviceId: input.deviceId,
            id: targetMessageId,
        },
        select: {
            id: true,
            from: true,
            participant: true,
            pushName: true,
            message: true,
            mediaPath: true,
            fileName: true,
            receivedAt: true,
            editSecret: {
                select: { senderJid: true },
            },
        },
    });
    if (!target || !sameJid(target.from, input.conversationJid)) {
        throw new Error('Pesan yang akan dibalas tidak ditemukan pada percakapan ini');
    }

    const quotedText = decryptMessage(target.message) || '[Pesan]';
    const quotedParticipant = target.editSecret?.senderJid || target.participant;
    return {
        quotedMessageId: target.id,
        quotedFromMe: false,
        quotedText,
        quotedSender: target.pushName || senderLabel(target.participant),
        deliveryJid: target.from,
        quoted: {
            key: {
                remoteJid: target.from,
                id: target.id,
                fromMe: false,
                ...(target.from.endsWith('@g.us') && quotedParticipant
                    ? { participant: quotedParticipant }
                    : {}),
            },
            message: buildInboxQuotedMessageContent({
                text: quotedText,
                mediaPath: target.mediaPath,
                fileName: target.fileName,
            }),
            messageTimestamp: Math.floor(target.receivedAt.getTime() / 1000),
            pushName: target.pushName || undefined,
        },
    };
}

/** Resolve a WhatsApp quote received from another client into stable Inbox metadata. */
export async function resolveIncomingQuoteMetadata(input: {
    deviceId: number;
    conversationJid: string;
    content: proto.IMessage | null | undefined;
}): Promise<InboxQuoteMetadata | null> {
    const contextInfo = quoteContextInfo(input.content);
    const quotedMessageId = String(contextInfo?.stanzaId || '').trim();
    if (!quotedMessageId) return null;

    const [outgoing, incoming] = await Promise.all([
        prisma.outgoingMessage.findFirst({
            where: {
                deviceId: input.deviceId,
                OR: [{ id: quotedMessageId }, { waMessageId: quotedMessageId }],
            },
            select: { id: true, waMessageId: true, to: true, message: true },
        }),
        prisma.incomingMessage.findFirst({
            where: { deviceId: input.deviceId, id: quotedMessageId },
            select: {
                id: true,
                from: true,
                participant: true,
                pushName: true,
                message: true,
            },
        }),
    ]);

    if (outgoing && sameJid(outgoing.to, input.conversationJid)) {
        return {
            quotedMessageId: outgoing.waMessageId || outgoing.id,
            quotedFromMe: true,
            quotedText: decryptMessage(outgoing.message) || '[Pesan]',
            quotedSender: 'Anda',
        };
    }
    if (incoming && sameJid(incoming.from, input.conversationJid)) {
        return {
            quotedMessageId: incoming.id,
            quotedFromMe: false,
            quotedText: decryptMessage(incoming.message) || '[Pesan]',
            quotedSender: incoming.pushName || senderLabel(incoming.participant),
        };
    }

    const quotedText = extractSupportedMessageText(contextInfo?.quotedMessage) || '[Pesan]';
    return {
        quotedMessageId,
        quotedFromMe: null,
        quotedText,
        quotedSender: senderLabel(contextInfo?.participant),
    };
}
