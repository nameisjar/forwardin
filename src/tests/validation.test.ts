import request from 'supertest';
import { expect } from 'chai';

import app from '../index';
import prisma from '../utils/db';

describe('Registration Validation', () => {
    it('should return 400 with validation errors when invalid data is sent', async () => {
        const response = await request(app)
            .post('/auth/register')
            .send({
                username: 'user',
                phone: '62',
                email: 'invalid',
                password: '11',
                confirmPassword: '12',
            })
            .set('Content-Type', 'application/json')
            .expect(400);

        // console.log('Response body:', response.body);
        expect(response.body).to.have.property('errors');
    });

    it('should return 201 when valid data is sent', async () => {
        const response = await request(app)
            .post('/auth/register')
            .send({
                username: 'testuser',
                phone: '628886945381',
                email: 'test@example.com',
                password: 'P4$sword!!!',
                confirmPassword: 'P4$sword!!!',
            })
            .expect(201);

        console.log('Response body:', response.body);
        expect(response.body).to.have.property('accessToken');
        expect(response.body).to.have.property('refreshToken');
    });
});

let accessToken: string;

describe('Login Validation', () => {
    it('should return 200 with valid credentials', async () => {
        const response = await request(app)
            .post('/auth/login')
            .send({ identifier: 'test@example.com', password: 'P4$sword!!!' }) // Valid credentials
            .set('Content-Type', 'application/json')
            .expect(200);

        accessToken = response.body.accessToken;
        // console.log('Response body:', response.body);
        expect(response.body).to.have.property('accessToken');
        expect(response.body).to.have.property('refreshToken');
    });

    it('should return 401 with invalid credentials', async () => {
        const response = await request(app)
            .post('/auth/login')
            .send({ identifier: 'test@example.com', password: 'invalidpassword' }) // Invalid password
            .set('Content-Type', 'application/json')
            .expect(401);

        console.log('Response body:', response.body);
        expect(response.body).to.have.property('message', 'Wrong password');
    });

    it('should return 401 with non-existent username', async () => {
        const response = await request(app)
            .post('/auth/login')
            .send({ identifier: 'nonexistent@user', password: 'testpassword' }) // Non-existent username
            .set('Content-Type', 'application/json')
            .expect(401);

        console.log('Response body:', response.body);
        expect(response.body).to.have.property('message', 'Account not found');
    });
});

describe('Email Verification', () => {
    let pkId: number = 0;
    let otpToken: string;

    before(async () => {
        const existingUser = await prisma.user.findFirst({
            where: {
                email: 'test@example.com',
            },
        });
        if (existingUser) {
            pkId = existingUser.pkId;
        } else {
            throw new Error('Existing user not found');
        }
    });

    it('should send a verification email', async () => {
        const response = await request(app)
            .post('/auth/send-verification-email')
            .send({ pkId, email: 'test@example.com' })
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${accessToken}`)
            .expect(200);

        otpToken = response.body.otpToken;
        expect(response.body).to.have.property('otpToken');
    });

    it('should verify the email using a token', async () => {
        const response = await request(app)
            .post('/auth/verify-email')
            .send({ pkId, otpToken })
            .set('Authorization', `Bearer ${accessToken}`)
            .set('Content-Type', 'application/json')
            .expect(200);

        expect(response.body).to.eql({ message: 'Email verification successful' });
    });

    after(async () => {
        await prisma.user.deleteMany({
            where: {
                OR: [
                    { username: 'testuser' },
                    { phone: '628927055900' },
                    { email: 'test@example.com' },
                ],
            },
        });
    });
});
