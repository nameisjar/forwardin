import prisma from '../utils/db';
import logger from '../config/logger';
import { getSocketIO } from '../socket';
import { encryptMessage } from '../utils/messageEncryption';

type ApplyIncomingMessageEditInput = {
    sessionId: string;
    deviceId: number;
    messageId: string;
    text: string;
    editedAt: Date;
    remoteJid?: string | null;
};

/** Update an existing incoming WhatsApp message without creating a new row. */
export async function applyIncomingMessageEdit({
    sessionId,
    deviceId,
    messageId,
    text,
    editedAt,
    remoteJid,
}: ApplyIncomingMessageEditInput) {
    let existingMessage = null;
    for (const retryDelay of [0, 100, 500]) {
        if (retryDelay) {
            await new Promise(resolve => setTimeout(resolve, retryDelay));
        }
        existingMessage = await prisma.incomingMessage.findFirst({
            where: {
                id: messageId,
                OR: [
                    { deviceId },
                    { sessionId },
                ],
            },
            select: {
                pkId: true,
                id: true,
                from: true,
            },
        });
        if (existingMessage) break;
    }

    if (!existingMessage) {
        logger.warn(
            { sessionId, messageId, remoteJid },
            'Incoming message edit references an unknown original message',
        );
        return null;
    }

    const editedMessage = await prisma.incomingMessage.update({
        where: { pkId: existingMessage.pkId },
        data: {
            message: encryptMessage(text),
            editedAt,
            updatedAt: new Date(),
        },
        select: {
            pkId: true,
            id: true,
            from: true,
            receivedAt: true,
            editedAt: true,
            isRead: true,
        },
    });

    const publicDevice = await prisma.device.findUnique({
        where: { pkId: deviceId },
        select: { id: true },
    });
    const io = getSocketIO();
    const emitter = publicDevice?.id
        ? io.to(`session:${sessionId}`).to(`device:${publicDevice.id}`)
        : io.to(`session:${sessionId}`);
    emitter.emit(`incoming:${sessionId}:message-edited`, {
        ...editedMessage,
        message: text,
        editedAt: editedMessage.editedAt?.toISOString() || null,
        receivedAt: editedMessage.receivedAt.toISOString(),
    });

    logger.info(
        { sessionId, messageId, deviceId },
        'Incoming WhatsApp message updated after edit',
    );
    return editedMessage;
}
