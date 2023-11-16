/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from './db';
import { generateSlug } from './slug';

export async function getRecipients(broadcast: any) {
    // get recipients util
    const recipients: string[] = [];
    for (const recipient of broadcast.recipients) {
        // all == all contacts
        // label == contact labels
        // can't use "all" and "label" at the same time
        if (recipient.includes('all')) {
            const contacts = await prisma.contact.findMany({
                where: { contactDevices: { some: { deviceId: broadcast.deviceId } } },
            });
            contacts.map((c) => {
                if (!recipients.includes(c.phone)) {
                    recipients.push(c.phone);
                }
            });
        } else if (recipient.includes('label')) {
            const contactLabel = recipient.split('_')[1];

            const contacts = await prisma.contact.findMany({
                where: {
                    contactDevices: { some: { deviceId: broadcast.deviceId } },
                    ContactLabel: { some: { label: { slug: generateSlug(contactLabel) } } },
                },
            });

            contacts.map((c) => {
                if (!recipients.includes(c.phone)) {
                    recipients.push(c.phone);
                }
            });
        } else if (recipient.includes('group')) {
            const groupName = recipient.split('_')[1];
            const group = await prisma.group.findFirst({
                where: {
                    contactGroups: {
                        some: {
                            contact: {
                                contactDevices: { some: { deviceId: broadcast.deviceId } },
                            },
                        },
                    },
                    name: groupName,
                },
                include: {
                    contactGroups: { select: { contact: { select: { phone: true } } } },
                },
            });
            group?.contactGroups.map((c) => {
                if (!recipients.includes(c.contact.phone)) {
                    recipients.push(c.contact.phone);
                }
            });
        } else {
            recipients.push(recipient);
        }
    }
    return recipients;
}
