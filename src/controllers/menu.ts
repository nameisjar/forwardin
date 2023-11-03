import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';

export const getMenus: RequestHandler = async (req, res) => {
    try {
        const menus = await prisma.menu.findMany();
        res.status(200).json(menus);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const assignPrivilegetoMenu: RequestHandler = async (req, res) => {
    try {
        const { privilegeId, menuId } = req.body;

        const privilege = await prisma.privilege.findUnique({
            where: { id: privilegeId },
        });

        if (!privilege) {
            return res.status(404).json({ message: 'Privilege not found' });
        }

        const menu = await prisma.menu.findUnique({
            where: { id: menuId },
        });

        if (!menu) {
            return res.status(404).json({ message: 'Menu not found' });
        }

        const menuPrivilege = await prisma.menuPrivilege.create({
            data: {
                menuId: menu.pkId,
                privilegeId: privilege.pkId,
            },
        });
        res.status(200).json(menuPrivilege);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getMenusByUserId: RequestHandler = async (req, res) => {
    const userId = req.params.userId;
    const type = req.query.type as string | undefined;
    const isActiveParam = req.query.isActive as string | undefined;

    const isActive = isActiveParam === 'true';

    const user = await prisma.user.findUnique({
        where: { id: userId },
    });

    if (!user) {
        return res.status(404).json({ message: 'User not found' });
    }

    const menu = await prisma.menu.findMany({
        where: {
            menuPrivileges: { some: { privilege: { users: { some: { pkId: user.pkId } } } } },
            type,
            isActive,
        },
    });

    if (!menu) {
        return res.status(404).json({ message: 'Menu not found' });
    }

    res.json(menu);
};
