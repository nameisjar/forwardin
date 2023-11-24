import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const getPrivileges: RequestHandler = async (req, res) => {
    try {
        const privilege = req.query.privilegeId;

        const privileges = await prisma.privilegeRole.findMany({
            where: { privilegeId: privilege ? Number(req.query.privilegeId) : undefined },
            include: {
                privilege: true,
                module: true,
            },
        });
        res.status(200).json(privileges);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const updatePrivilege: RequestHandler = async (req, res) => {
    try {
        const { isVisible, isCreate, isDelete, isRead, isEdit } = req.body;
        const { privilegeId, moduleId } = req.params;

        const privilege = await prisma.privilege.findUnique({
            where: { id: privilegeId },
        });

        if (!privilege) {
            return res.status(404).json({ message: 'Privilege not found' });
        }

        const modul = await prisma.module.findUnique({
            where: { id: moduleId },
        });

        if (!modul) {
            return res.status(404).json({ message: 'Module not found' });
        }

        await prisma.privilegeRole.update({
            where: { moduleId_privilegeId: { privilegeId: privilege.pkId, moduleId: modul.pkId } },
            data: { isCreate, isDelete, isEdit, isRead, isVisible },
        });

        res.status(200).json({ message: 'Privilege role updated successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
