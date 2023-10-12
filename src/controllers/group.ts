import { RequestHandler } from 'express';
import prisma from '../utils/db';

export const getGroups: RequestHandler = async (req, res) => {
    const userId = req.prismaUser.pkId;
    try {
        const groups = await prisma.group.findMany({
            where: { userId },
        });
        res.status(200).json(groups);
    } catch (error) {
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const createGroup: RequestHandler = async (req, res) => {
    const { name } = req.body;
    const userId = req.prismaUser.pkId;

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
            where: { id: groupId },
        });

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const addedContactIds: string[] = [];
        const failedContactIds: string[] = [];

        // use `Promise.all` to parallelize contact operations and track results
        await Promise.all(
            contactIds.map(async (contactId: string) => {
                try {
                    const contact = await prisma.contact.findUnique({
                        where: { id: contactId },
                    });

                    if (!contact) {
                        failedContactIds.push(contactId);
                    } else {
                        await prisma.contactGroup.upsert({
                            where: {
                                contactId_groupId: {
                                    contactId: contact.pkId,
                                    groupId: group.pkId,
                                },
                            },
                            create: {
                                contactId: contact.pkId,
                                groupId: group.pkId,
                            },
                            update: {
                                contactId: contact.pkId,
                                groupId: group.pkId,
                            },
                        });

                        addedContactIds.push(contactId);
                    }
                } catch (error) {
                    console.error(`Error adding contact ${contactId} to group:`, error);
                    failedContactIds.push(contactId);
                }
            }),
        );

        if (addedContactIds.length > 0) {
            res.status(200).json({
                message: 'Contact(s) added to group successfully',
                addedContactIds,
            });
        } else {
            res.status(404).json({
                message: 'No contacts were added to the group',
                failedContactIds,
            });
        }
    } catch (error) {
        console.error('Error adding contacts to group:', error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const removeMemberFromGroup: RequestHandler = async (req, res) => {
    try {
        const { groupId, contactId } = req.body;

        const group = await prisma.group.findUnique({
            where: { id: groupId },
        });

        if (!group) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const contact = await prisma.contact.findUnique({
            where: { id: contactId },
        });

        if (!contact) {
            return res.status(404).json({ message: 'Group not found' });
        }

        const groupContact = await prisma.contactGroup.findUnique({
            where: {
                contactId_groupId: {
                    contactId: contact.pkId,
                    groupId: group.pkId,
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
            where: { pkId: existingGroup.pkId },
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

export const deleteGroups: RequestHandler = async (req, res) => {
    try {
        const groupIds = req.body.groupIds;

        const groupPromises = groupIds.map(async (groupId: string) => {
            await prisma.group.delete({
                where: { id: groupId },
            });
        });

        await Promise.all(groupPromises);

        res.status(200).json({ message: 'Group(s) deleted successfully' });
    } catch (error) {
        console.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
