/* eslint-disable @typescript-eslint/no-explicit-any */
import prisma from './db';
import { generateSlug } from './slug';

export async function getRecipients(broadcast: any) {
    // get recipients util
    const out = new Set<string>();
    const devId = broadcast.deviceId; // expects Device.pkId (number)

    for (const recipient of broadcast.recipients as string[]) {
        const token = String(recipient || '').trim();
        if (!token) continue;

        // all == all contacts for the device
        if (token === 'all') {
            const contacts = await prisma.contact.findMany({
                where: { contactDevices: { some: { deviceId: devId } } },
                select: { phone: true },
            });
            for (const c of contacts) if (c.phone) out.add(String(c.phone));
            continue;
        }

        // label == contact labels
        if (token.startsWith('label_')) {
            const raw = token.slice('label_'.length);
            const slug = generateSlug(raw);
            const nameEq = raw; // try exact name match as well

            const contacts = await prisma.contact.findMany({
                where: {
                    contactDevices: { some: { deviceId: devId } },
                    ContactLabel: {
                        some: {
                            OR: [{ label: { slug } }, { label: { name: nameEq } }],
                        },
                    },
                },
                select: { phone: true },
            });
            for (const c of contacts) if (c.phone) out.add(String(c.phone));
            continue;
        }

        // group_<name> (legacy) -> expand to group's contacts on this device
        if (token.startsWith('group_')) {
            const groupName = token.slice('group_'.length);
            const group = await prisma.group.findFirst({
                where: {
                    name: groupName,
                    contactGroups: {
                        some: {
                            contact: { contactDevices: { some: { deviceId: devId } } },
                        },
                    },
                },
                include: { contactGroups: { select: { contact: { select: { phone: true } } } } },
            });
            for (const cg of group?.contactGroups || [])
                if (cg.contact?.phone) out.add(String(cg.contact.phone));
            continue;
        }

        // else: assume direct phone or group JID, push as-is (later normalized by sender)
        out.add(token);
    }

    return Array.from(out);
}
