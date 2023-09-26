import { RequestHandler } from 'express';
import prisma from '../utils/db';

export const getGroups: RequestHandler = async (req, res) => {
    const userId = req.user.pkId;
    try {
        const contacts = await prisma.group.findMany({
            where: { userId },
        });
        res.status(200).json(contacts);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createGroup: RequestHandler = async (req, res) => {
    const { name } = req.body;
    const userId = req.user.pkId;

    try {
        await prisma.group.create({
            data: {
                name,
                isCampaign: false,
                user: { connect: { pkId: userId } },
            },
        });
        res.status(200).json({ message: 'Group created successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const addMemberToGroup: RequestHandler = async (req, res) => {
    try {
        const { groupId, contactIds } = req.body;

        const group = await prisma.group.findUnique({
            where: { pkId: groupId },
        });

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const groupPromises = contactIds.map(async (contactId: number) => {
            await prisma.contactGroup.upsert({
                where: {
                    contactId_groupId: {
                        contactId: contactId,
                        groupId: groupId,
                    },
                },
                create: {
                    groupId,
                    contactId,
                },
                update: {
                    groupId,
                    contactId,
                },
            });
        });

        await Promise.all(groupPromises);

        res.status(200).json({ message: 'Contact(s) added to group successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const removeMemberFromGroup: RequestHandler = async (req, res) => {
    try {
        const { groupId, contactId } = req.body;

        const groupContact = await prisma.contactGroup.findUnique({
            where: {
                contactId_groupId: {
                    contactId: contactId,
                    groupId: groupId,
                },
            },
        });

        if (!groupContact) {
            return res.status(404).json({ message: 'Member not found in the group' });
        }

        await prisma.contactGroup.delete({
            where: {
                pkId: groupContact.pkId,
            },
        });

        res.status(200).json({ message: 'Member removed from group successfully' });
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getGroup: RequestHandler = async (req, res) => {
    try {
        const groupId = req.params.groupId;

        const group = await prisma.group.findUnique({
            where: { id: groupId },
            include: {
                contactGroups: {
                    include: {
                        contact: true,
                    },
                },
            },
        });

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        res.status(200).json(group);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updatedGroup: RequestHandler = async (req, res) => {
    try {
        const groupId = req.params.groupId;
        const { name, isCampaign } = req.body;

        const existingGroup = await prisma.group.findUnique({
            where: { id: groupId },
        });

        if (!existingGroup) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const updatedGroup = await prisma.group.update({
            where: { id: groupId },
            data: {
                name,
                isCampaign,
            },
        });

        res.status(200).json({ message: 'Group updated successfully', data: updatedGroup });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
