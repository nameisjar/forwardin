import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getInstance, getJid } from '../whatsapp';
import logger from '../config/logger';
import { replaceVariables } from '../utils/variableHelper';

export const createBusinessHour: RequestHandler = async (req, res) => {
    const {
        message,
        monStart,
        monEnd,
        tueStart,
        tueEnd,
        wedStart,
        wedEnd,
        thuStart,
        thuEnd,
        friStart,
        friEnd,
        satStart,
        satEnd,
        sunStart,
        sunEnd,
        deviceId,
    } = req.body;
    try {
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        if (!device) {
            return res.status(401).json({ message: 'Device not found' });
        }
        const businessHour = await prisma.businessHour.create({
            data: {
                message,
                monStart,
                monEnd,
                tueStart,
                tueEnd,
                wedStart,
                wedEnd,
                thuStart,
                thuEnd,
                friStart,
                friEnd,
                satStart,
                satEnd,
                sunStart,
                sunEnd,
                deviceId: device.pkId,
            },
        });

        res.status(201).json(businessHour);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getAllBusinessHours: RequestHandler = async (req, res) => {
    const deviceId = req.params.id;

    const device = await prisma.device.findUnique({
        where: { id: deviceId },
    });

    if (!device) {
        return res.status(401).json({ message: 'Device not found' });
    }
    try {
        const businessHours = await prisma.businessHour.findMany({
            where: {
                deviceId: device.pkId,
            },
        });

        res.status(200).json(businessHours);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

function getDayOfWeek(timestamp: number) {
    const date = new Date(timestamp * 1000);
    const daysOfWeek = [
        'sunday',
        'monday',
        'tuesday',
        'wednesday',
        'thursday',
        'friday',
        'saturday',
    ];
    return daysOfWeek[date.getDay()];
}

function getMessageTime(timestamp: number): Date {
    return new Date(timestamp * 1000);
}

type BusinessHours = {
    mon: { start: number | null; end: number | null };
    tue: { start: number | null; end: number | null };
    wed: { start: number | null; end: number | null };
    thu: { start: number | null; end: number | null };
    fri: { start: number | null; end: number | null };
    sat: { start: number | null; end: number | null };
    sun: { start: number | null; end: number | null };
};

function isOutsideBusinessHours(timestamp: number, businessHours: BusinessHours): boolean {
    if (!businessHours) {
        return false;
    }

    const dayOfWeek = getDayOfWeek(timestamp);
    const messageTime = getMessageTime(timestamp);

    const dayKey = `${dayOfWeek.substring(0, 3).toLowerCase()}`;
    const day = businessHours[dayKey as keyof BusinessHours];

    const startMinutes = day.start !== null ? day.start * 60 : 0;
    const endMinutes = day.end !== null ? day.end * 60 : 24 * 60; // 24 hours if end is null
    const messageMinutes = messageTime.getHours() * 60 + messageTime.getMinutes();

    return messageMinutes < startMinutes || messageMinutes > endMinutes;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export async function sendOutsideBusinessHourMessage(sessionId: any, data: any) {
    try {
        const session = getInstance(sessionId)!;
        const recipient = data.key.remoteJid;
        const jid = getJid(recipient);
        const name = data.pushName;
        const timestamp = data.messageTimestamp;

        const businessHourRecord = await prisma.businessHour.findFirst({
            where: {
                device: { sessions: { some: { sessionId } } },
            },
        });

        const repliedBusinessHour = await prisma.outgoingMessage.findFirst({
            where: {
                id: { contains: `BH_${businessHourRecord?.pkId}` },
                to: jid,
                sessionId,
            },
        });

        const businessHours: BusinessHours = {
            mon: {
                start: businessHourRecord?.monStart ?? null,
                end: businessHourRecord?.monEnd ?? null,
            },
            tue: {
                start: businessHourRecord?.tueStart ?? null,
                end: businessHourRecord?.tueEnd ?? null,
            },
            wed: {
                start: businessHourRecord?.wedStart ?? null,
                end: businessHourRecord?.wedEnd ?? null,
            },
            thu: {
                start: businessHourRecord?.thuStart ?? null,
                end: businessHourRecord?.thuEnd ?? null,
            },
            fri: {
                start: businessHourRecord?.friStart ?? null,
                end: businessHourRecord?.friEnd ?? null,
            },
            sat: {
                start: businessHourRecord?.satStart ?? null,
                end: businessHourRecord?.satEnd ?? null,
            },
            sun: {
                start: businessHourRecord?.sunStart ?? null,
                end: businessHourRecord?.sunEnd ?? null,
            },
        };

        const outsideBusinessHours = isOutsideBusinessHours(timestamp, businessHours);

        if (outsideBusinessHours && !repliedBusinessHour) {
            const replyText = businessHourRecord!.message;

            // back here: complete the provided variables
            const variables = {
                name: name,
                firstName: name,
            };

            // back here: send non-text message
            // session.readMessages([data.key]);
            session.sendMessage(
                jid,
                { text: replaceVariables(replyText, variables) },
                { quoted: data, messageId: `BH_${businessHourRecord?.pkId}_${Date.now()}` },
            );
            logger.warn(outsideBusinessHours, 'outside business hours response sent successfully');
        }
    } catch (error) {
        logger.error(error);
    }
}
