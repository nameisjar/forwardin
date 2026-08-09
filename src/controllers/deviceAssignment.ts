import { RequestHandler } from 'express';
import prisma from '../utils/db';
import logger from '../config/logger';
import { isUUID } from '../utils/uuidChecker';
import { isDeviceAdmin, ownedDeviceWhere } from '../utils/deviceAccess';
import { syncUserDeviceSocketAccess } from '../socket';

function ensureAdmin(req: Parameters<RequestHandler>[0], res: Parameters<RequestHandler>[1]) {
    if (!isDeviceAdmin(req.privilege?.pkId)) {
        res.status(403).json({ message: 'Access denied: Admin only' });
        return false;
    }
    return true;
}

async function findManageableDevice(req: Parameters<RequestHandler>[0], deviceId: string) {
    return prisma.device.findFirst({
        where: {
            id: deviceId,
            ...ownedDeviceWhere(req.authenticatedUser.pkId, req.privilege?.pkId),
        },
        select: {
            pkId: true,
            id: true,
            name: true,
            userId: true,
            sessions: { select: { sessionId: true } },
        },
    });
}

export const getAssignmentUsers: RequestHandler = async (req, res) => {
    if (!ensureAdmin(req, res)) return;

    try {
        const users = await prisma.user.findMany({
            where: {
                deletedAt: null,
                pkId: { not: req.authenticatedUser.pkId },
            },
            select: {
                id: true,
                firstName: true,
                lastName: true,
                email: true,
                privilege: { select: { name: true } },
            },
            orderBy: [{ firstName: 'asc' }, { email: 'asc' }],
        });

        res.status(200).json(users);
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const getDeviceAssignments: RequestHandler = async (req, res) => {
    if (!ensureAdmin(req, res)) return;

    const { deviceId } = req.params;
    if (!isUUID(deviceId)) {
        return res.status(400).json({ message: 'Invalid deviceId' });
    }

    try {
        const device = await findManageableDevice(req, deviceId);
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const assignments = await prisma.deviceAssignment.findMany({
            where: { deviceId: device.pkId },
            select: {
                id: true,
                createdAt: true,
                user: {
                    select: {
                        id: true,
                        firstName: true,
                        lastName: true,
                        email: true,
                        privilege: { select: { name: true } },
                    },
                },
                assignedBy: {
                    select: { id: true, firstName: true, lastName: true, email: true },
                },
            },
            orderBy: { createdAt: 'desc' },
        });

        res.status(200).json({ device, assignments });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const assignDevice: RequestHandler = async (req, res) => {
    if (!ensureAdmin(req, res)) return;

    const { deviceId } = req.params;
    const targetUserId = String(req.body?.userId || '');
    if (!isUUID(deviceId) || !isUUID(targetUserId)) {
        return res.status(400).json({ message: 'Invalid deviceId or userId' });
    }

    try {
        const [device, targetUser] = await Promise.all([
            findManageableDevice(req, deviceId),
            prisma.user.findFirst({
                where: { id: targetUserId, deletedAt: null },
                select: { pkId: true, id: true, firstName: true, lastName: true, email: true },
            }),
        ]);

        if (!device) return res.status(404).json({ message: 'Device not found' });
        if (!targetUser) return res.status(404).json({ message: 'User not found' });
        if (targetUser.pkId === device.userId) {
            return res.status(400).json({ message: 'User is already the device owner' });
        }

        const assignment = await prisma.deviceAssignment.upsert({
            where: {
                deviceId_userId: { deviceId: device.pkId, userId: targetUser.pkId },
            },
            create: {
                deviceId: device.pkId,
                userId: targetUser.pkId,
                assignedById: req.authenticatedUser.pkId,
            },
            update: {
                assignedById: req.authenticatedUser.pkId,
                updatedAt: new Date(),
            },
            select: { id: true, createdAt: true },
        });

        await syncUserDeviceSocketAccess(
            targetUser.pkId,
            device.id,
            device.sessions.map((session) => session.sessionId),
            true,
        );

        res.status(201).json({
            message: 'Device assigned successfully',
            assignment: { ...assignment, user: targetUser },
        });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};

export const revokeDeviceAssignment: RequestHandler = async (req, res) => {
    if (!ensureAdmin(req, res)) return;

    const { deviceId, userId } = req.params;
    if (!isUUID(deviceId) || !isUUID(userId)) {
        return res.status(400).json({ message: 'Invalid deviceId or userId' });
    }

    try {
        const device = await findManageableDevice(req, deviceId);
        if (!device) return res.status(404).json({ message: 'Device not found' });

        const targetUser = await prisma.user.findUnique({
            where: { id: userId },
            select: { pkId: true },
        });
        if (!targetUser) return res.status(404).json({ message: 'User not found' });

        const result = await prisma.deviceAssignment.deleteMany({
            where: { deviceId: device.pkId, userId: targetUser.pkId },
        });
        if (result.count === 0) {
            return res.status(404).json({ message: 'Device assignment not found' });
        }

        await syncUserDeviceSocketAccess(
            targetUser.pkId,
            device.id,
            device.sessions.map((session) => session.sessionId),
            false,
        );

        res.status(200).json({ message: 'Device access revoked successfully' });
    } catch (error) {
        logger.error(error);
        res.status(500).json({ message: 'Internal server error' });
    }
};
