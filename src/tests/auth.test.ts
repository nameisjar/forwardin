import request from 'supertest';
import { expect } from 'chai';

import app from '../index';
import prisma from '../utils/db';

interface UserData {
    firstName: string;
    lastName: string;
    username: string;
    phone: string;
    email: string;
    password: string;
    confirmPassword: string;
}

interface LoginData {
    identifier: string;
    password: string;
}

const registerUser = async (userData: UserData) => {
    return request(app)
        .post('/auth/register')
        .send(userData)
        .set('Content-Type', 'application/json');
};

const loginUser = async (loginData: LoginData) => {
    return request(app).post('/auth/login').send(loginData).set('Content-Type', 'application/json');
};

describe('------Auth API------', () => {
    describe('Registration', () => {
        it('should return 400 with validation errors when invalid data is sent', async () => {
            const response = await registerUser({
                firstName: 'failed',
                lastName: 'user',
                username: 'fail_user',
                phone: '62',
                email: 'invalid',
                password: '11',
                confirmPassword: '12',
            });

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('errors');
        });

        it('should return 201 when valid data is sent', async () => {
            const response = await registerUser({
                firstName: 'successful',
                lastName: 'user',
                username: 'success_user',
                phone: '628886945381',
                email: 'test@example.com',
                password: 'P4$sword!!!',
                confirmPassword: 'P4$sword!!!',
            });

            expect(response.status).to.equal(201);
            expect(response.body).to.have.property('accessToken');
            expect(response.body).to.have.property('refreshToken');
            expect(response.body).to.have.property('accountApiKey');
        });
    });

    let authToken: string;

    describe('Login', () => {
        before(async () => {
            const response = await loginUser({
                identifier: 'test@example.com',
                password: 'P4$sword!!!',
            });

            expect(response.status).to.equal(200);

            authToken = response.body.accessToken;
        });

        it('should return 401 with invalid credentials', async () => {
            const response = await loginUser({
                identifier: 'test@example.com',
                password: 'invalidpassword',
            });

            expect(response.status).to.equal(401);
            expect(response.body).to.have.property('message', 'Wrong password');
        });

        it('should return 401 with non-existent username', async () => {
            const response = await loginUser({
                identifier: 'nonexistent@user',
                password: 'testpassword',
            });

            expect(response.status).to.equal(401);
            expect(response.body).to.have.property('message', 'Account not found');
        });
    });

    describe('Email Verification', () => {
        let pkId: number = 0;
        let otpToken: string;

        before(async () => {
            const existingUser = await prisma.user.findUnique({
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
                .set('Authorization', `Bearer ${authToken}`);

            expect(response.status).to.equal(200);
            expect(response.body).to.have.property('otpToken');
            otpToken = response.body.otpToken;
        });

        it('should verify the email using a token', async () => {
            const response = await request(app)
                .post('/auth/verify-email')
                .send({ pkId, otpToken })
                .set('Authorization', `Bearer ${authToken}`)
                .set('Content-Type', 'application/json');

            expect(response.status).to.equal(200);
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
});
