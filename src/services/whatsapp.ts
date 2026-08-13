import prisma from '../utils/db';
import logger from '../config/logger';
import { getInstance } from '../whatsapp';
import { redactPhone } from '../utils/logRedaction';
import { sendDocumentMessage, sendTextMessage } from './messageSender';

/**
 * Send document via WhatsApp
 */
export const sendDocument = async (
    deviceId: string,
    recipient: string,
    documentBuffer: Buffer,
    fileName: string,
    caption?: string
): Promise<void> => {
    try {
        // 🔒 Log tanpa nomor telepon lengkap
        logger.info('sendDocument called', {
            deviceId,
            recipient: redactPhone(recipient),
            fileName,
            bufferSize: documentBuffer.length,
            hasCaption: !!caption
        });

        // Get device to find sessionId
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            include: {
                sessions: {
                    where: {
                        id: {
                            contains: 'config'
                        }
                    },
                    take: 1
                }
            }
        });

        if (!device) {
            logger.error('Device not found:', deviceId);
            throw new Error('Device not found');
        }

        logger.info('Device found:', {
            name: device.name,
            sessionId: device.sessions[0]?.sessionId
        });

        // Get sessionId from device sessions
        const sessionId = device.sessions[0]?.sessionId;
        
        if (!sessionId) {
            logger.error('No active session found for device:', deviceId);
            throw new Error('No active WhatsApp session found for this device');
        }

        // Get WhatsApp instance using sessionId
        const session = getInstance(sessionId);
        
        if (!session) {
            logger.error('WhatsApp instance not found for sessionId:', sessionId);
            throw new Error('WhatsApp session not found');
        }

        if (!session.user) {
            logger.error('WhatsApp session not connected for sessionId:', sessionId);
            throw new Error('WhatsApp session not connected');
        }

        logger.info('WhatsApp session found and connected:', {
            sessionId,
            user: session.user?.id ? redactPhone(session.user.id) : undefined
        });

        // Format recipient number (ensure it has @s.whatsapp.net)
        const formattedRecipient = recipient.includes('@') 
            ? recipient 
            : `${recipient}@s.whatsapp.net`;

        logger.debug('Sending document', { recipient: redactPhone(formattedRecipient) });

        const queued = await sendDocumentMessage(
            session,
            deviceId,
            formattedRecipient,
            documentBuffer,
            {
                fileName,
                mimetype: 'application/pdf',
                caption: caption || '',
            },
        );
        if (!queued.success) throw new Error(queued.error || 'Document send failed');
        const result = queued.result;

        logger.info(`Document sent successfully`, {
            recipient: redactPhone(recipient),
            messageId: result?.key?.id
        });
    } catch (error) {
        logger.error('Error in sendDocument:', {
            error: error instanceof Error ? error.message : String(error),
            deviceId,
            recipient: redactPhone(recipient)
        });
        throw error; // Re-throw original error instead of generic one
    }
};

/**
 * Send message via WhatsApp
 */
export const sendMessage = async (
    deviceId: string,
    recipient: string,
    message: string
): Promise<void> => {
    try {
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
            include: {
                sessions: {
                    where: { id: { contains: 'config' } },
                    take: 1,
                },
            },
        });
        const sessionId = device?.sessions[0]?.sessionId;
        if (!sessionId) throw new Error('No active WhatsApp session found for this device');
        const session = getInstance(sessionId);

        const formattedRecipient = recipient.includes('@') 
            ? recipient 
            : `${recipient}@s.whatsapp.net`;

        const queued = await sendTextMessage(
            session,
            deviceId,
            formattedRecipient,
            message,
        );
        if (!queued.success) throw new Error(queued.error || 'Failed to send message');

        logger.info('Message sent successfully', { recipient: redactPhone(recipient) });
    } catch (error) {
        logger.error('Error sending message', { 
            error: error instanceof Error ? error.message : String(error),
            recipient: redactPhone(recipient)
        });
        throw new Error('Failed to send message via WhatsApp');
    }
};
