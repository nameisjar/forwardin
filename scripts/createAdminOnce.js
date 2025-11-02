require('dotenv').config();
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcrypt');
const { v4: uuidv4 } = require('uuid');

(async () => {
    const prisma = new PrismaClient();
    try {
        const ADMIN_ID = Number(process.env.ADMIN_ID) || 2;

        // Ensure admin privilege exists
        let adminPriv = await prisma.privilege.findFirst({ where: { pkId: ADMIN_ID } });
        if (!adminPriv) {
            adminPriv = await prisma.privilege.upsert({
                where: { pkId: ADMIN_ID },
                create: { pkId: ADMIN_ID, name: 'admin' },
                update: {},
            });
        }

        const email = 'admin@gmail.com';
        const username = 'admin';
        const existing = await prisma.user.findFirst({ where: { OR: [{ email }, { username }] } });
        if (existing) {
            console.log(`Admin account already exists. Email: ${existing.email}`);
            return;
        }

        const password = 'admin123';
        const hashedPassword = await bcrypt.hash(password, 10);

        await prisma.user.create({
            data: {
                firstName: 'Admin',
                lastName: 'Forwardin',
                username,
                email,
                password: hashedPassword,
                accountApiKey: uuidv4(),
                affiliationCode: 'admin',
                emailVerifiedAt: new Date(),
                privilegeId: adminPriv.pkId,
            },
        });

        console.log('Admin account created successfully');
        console.log('Login credential:');
        console.log(`Email/Username: ${email} or ${username}`);
        console.log(`Password: ${password}`);
    } catch (e) {
        console.error(e);
        process.exitCode = 1;
    } finally {
        await prisma.$disconnect();
    }
})();
