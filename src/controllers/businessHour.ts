import { RequestHandler } from 'express';
import prisma from '../utils/db';
import { getInstance, getJid } from '../whatsapp';
import logger from '../config/logger';
import { replaceVariables } from '../utils/variableHelper';
import { format, parseISO } from 'date-fns';
import { utcToZonedTime } from 'date-fns-tz';
import { sendAutoReply } from './autoReply';
import { isUUID } from '../utils/uuidChecker';

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
        timeZone,
    } = req.body;
    try {
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }

        const createdBusinessHour = await prisma.businessHour.findFirst({
            where: { deviceId: device.pkId },
        });

        if (createdBusinessHour) {
            return res
                .status(400)
                .json({ message: 'Business hour for this device already created' });
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
                timeZone,
                deviceId: device.pkId,
            },
        });

        res.status(201).json(businessHour);
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updateBusinessHour: RequestHandler = async (req, res) => {
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
        timeZone,
    } = req.body;

    try {
        const device = await prisma.device.findUnique({
            where: { id: deviceId },
        });

        if (!device) {
            return res.status(404).json({ message: 'Device not found' });
        }
        const businessHour = await prisma.businessHour.update({
            where: { deviceId: device.pkId },
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
                timeZone,
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
    if (!isUUID(deviceId)) {
        return res.status(400).json({ message: 'Invalid deviceId' });
    }

    const device = await prisma.device.findUnique({
        where: { id: deviceId },
    });

    if (!device) {
        return res.status(404).json({ message: 'Device not found' });
    }
    try {
        const businessHours = await prisma.businessHour.findUnique({
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
    const daysOfWeek = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'];
    return daysOfWeek[date.getDay()];
}

function convertToBusinessTimeZone(timestamp: number, timeZone: string): Date {
    const userTime = parseISO(format(new Date(timestamp * 1000), "yyyy-MM-dd'T'HH:mm:ssxxx"));
    return utcToZonedTime(userTime, timeZone);
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

function isOutsideBusinessHours(
    timestamp: number,
    businessHours: BusinessHours,
    timeZone: string,
): boolean {
    if (!businessHours) {
        return false;
    }

    const dayOfWeek = getDayOfWeek(timestamp);
    const messageTime = convertToBusinessTimeZone(timestamp, timeZone);

    const dayKey = `${dayOfWeek.toLowerCase()}`;
    const day = businessHours[dayKey as keyof BusinessHours];

    // start && end are null == available a whole day
    const startMinutes = day.start !== null ? day.start : 0;
    const endMinutes = day.end !== null ? day.end : 24 * 60;
    const messageMinutes = messageTime.getHours() * 60 + messageTime.getMinutes();

    logger.warn(
        { timeZone, dayOfWeek, startMinutes, endMinutes, messageMinutes },
        'business hours',
    );

    // start = 24 || end = 0 == non available a whole day
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
        const phoneNumber = recipient.split('@')[0];

        const businessHourRecord = await prisma.businessHour.findFirst({
            where: {
                device: { sessions: { some: { sessionId } } },
            },
            include: { device: { select: { contactDevices: { select: { contact: true } } } } },
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

        const repliedBusinessHour = await prisma.outgoingMessage.findFirst({
            where: {
                id: { contains: `BH_${businessHourRecord?.pkId}` },
                to: jid,
                sessionId,
            },
        });

        const outsideBusinessHours = isOutsideBusinessHours(
            timestamp,
            businessHours,
            businessHourRecord?.timeZone ?? 'Etc/UTC',
        );

        if (outsideBusinessHours) {
            if (!repliedBusinessHour) {
                const replyText = businessHourRecord!.message;

                const variables = {
                    firstName:
                        businessHourRecord?.device.contactDevices.filter(
                            (cd) => cd.contact.phone == phoneNumber,
                        )[0]?.contact.firstName ?? name,
                    lastName:
                        businessHourRecord?.device.contactDevices.filter(
                            (cd) => cd.contact.phone == phoneNumber,
                        )[0]?.contact.lastName ?? undefined,
                    phoneNumber:
                        businessHourRecord?.device.contactDevices.filter(
                            (cd) => cd.contact.phone == phoneNumber,
                        )[0]?.contact.phone ?? undefined,
                    email:
                        businessHourRecord?.device.contactDevices.filter(
                            (cd) => cd.contact.phone == phoneNumber,
                        )[0]?.contact.email ?? undefined,
                };

                // ?back here: send non-text message
                // session.readMessages([data.key]);
                session.sendMessage(
                    jid,
                    { text: replaceVariables(replyText, variables) },
                    { quoted: data, messageId: `BH_${businessHourRecord!.pkId}_${Date.now()}` },
                );
            }
        } else {
            sendAutoReply(sessionId, data);
        }
    } catch (error) {
        logger.error(error);
    }
}
