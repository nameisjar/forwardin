import { expect } from 'chai';
import {
    accessibleDeviceWhere,
    classifyDeviceOwnership,
    isDeviceAdmin,
    ownedDeviceWhere,
} from '../utils/deviceAccess';

describe('device access scope', () => {
    const originalAdminId = process.env.ADMIN_ID;
    const originalSuperAdminId = process.env.SUPER_ADMIN_ID;

    before(() => {
        process.env.ADMIN_ID = '2';
        process.env.SUPER_ADMIN_ID = '1';
    });

    after(() => {
        if (originalAdminId === undefined) delete process.env.ADMIN_ID;
        else process.env.ADMIN_ID = originalAdminId;
        if (originalSuperAdminId === undefined) delete process.env.SUPER_ADMIN_ID;
        else process.env.SUPER_ADMIN_ID = originalSuperAdminId;
    });

    it('allows a regular user to access owned and assigned devices', () => {
        expect(accessibleDeviceWhere(42, 3)).to.deep.equal({
            OR: [
                { userId: 42 },
                { assignments: { some: { userId: 42 } } },
            ],
        });
    });

    it('does not grant destructive ownership through an assignment', () => {
        expect(ownedDeviceWhere(42, 3)).to.deep.equal({ userId: 42 });
    });

    it('keeps super admin operational access scoped to owned and assigned devices', () => {
        expect(accessibleDeviceWhere(42, 1)).to.deep.equal({
            OR: [
                { userId: 42 },
                { assignments: { some: { userId: 42 } } },
            ],
        });
        expect(ownedDeviceWhere(42, 1)).to.deep.equal({ userId: 42 });
    });

    it('recognizes admin and super admin assignment managers', () => {
        expect(isDeviceAdmin(2)).to.equal(true);
        expect(isDeviceAdmin(1)).to.equal(true);
        expect(isDeviceAdmin(3)).to.equal(false);
    });

    it('classifies monitoring ownership without granting operational access', () => {
        expect(classifyDeviceOwnership('tutor', 0)).to.equal('user_owned');
        expect(classifyDeviceOwnership('admin', 0)).to.equal('admin_owned');
        expect(classifyDeviceOwnership('super admin', 2)).to.equal('admin_assigned');
    });
});
