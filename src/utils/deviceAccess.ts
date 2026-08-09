import { Prisma } from '@prisma/client';

export function isSuperAdmin(privilegeId: number | undefined): boolean {
    return privilegeId === Number(process.env.SUPER_ADMIN_ID);
}

export function isDeviceAdmin(privilegeId: number | undefined): boolean {
    return (
        privilegeId === Number(process.env.ADMIN_ID) ||
        privilegeId === Number(process.env.SUPER_ADMIN_ID)
    );
}

/**
 * Device scope for normal product usage. Owners and explicitly assigned users
 * can use a device, while the super admin retains the existing global access.
 */
export function accessibleDeviceWhere(
    userPkId: number,
    privilegeId?: number,
): Prisma.DeviceWhereInput {
    if (isSuperAdmin(privilegeId)) return {};

    return {
        OR: [
            { userId: userPkId },
            { assignments: { some: { userId: userPkId } } },
        ],
    };
}

/**
 * Device scope for destructive/administrative actions. An assignment grants
 * usage only and never transfers ownership.
 */
export function ownedDeviceWhere(
    userPkId: number,
    privilegeId?: number,
): Prisma.DeviceWhereInput {
    return isSuperAdmin(privilegeId) ? {} : { userId: userPkId };
}
