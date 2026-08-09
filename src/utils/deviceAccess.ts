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
 * Device scope for normal product usage. Every role, including super admin,
 * can only use devices they own or devices explicitly assigned to them.
 * Cross-account visibility belongs exclusively to read-only monitoring APIs.
 */
export function accessibleDeviceWhere(
    userPkId: number,
    privilegeId?: number,
): Prisma.DeviceWhereInput {
    void privilegeId;
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
    void privilegeId;
    return { userId: userPkId };
}

export type DeviceOwnershipType = 'user_owned' | 'admin_owned' | 'admin_assigned';

export function classifyDeviceOwnership(
    ownerPrivilegeName: string | null | undefined,
    assignmentCount: number,
): DeviceOwnershipType {
    const role = ownerPrivilegeName?.trim().toLowerCase();
    const ownerIsAdmin = role === 'admin' || role === 'super admin';
    if (!ownerIsAdmin) return 'user_owned';
    return assignmentCount > 0 ? 'admin_assigned' : 'admin_owned';
}
