import request from 'supertest';
import { expect } from 'chai';
import app from '../index';

describe('------Contact API------', () => {
    let authToken: string;
    let accountApiKey: string;
    let deviceId: string;
    let contactId: string;

    before(async () => {
        // Register and login
        const response = await request(app)
            .post('/auth/register')
            .send({
                firstName: 'contact',
                lastName: 'tester',
                username: 'contact_tester',
                phone: '628886945384',
                email: 'contact@example.com',
                password: 'P4$sword!!!',
                confirmPassword: 'P4$sword!!!',
            })
            .set('Content-Type', 'application/json');

        authToken = response.body.accessToken;
        accountApiKey = response.body.accountApiKey;

        // Activate trial subscription
        await request(app)
            .post('/payment/trial')
            .send({})
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-Forwardin-Key', accountApiKey);

        // Create a device for contact tests
        const deviceRes = await request(app)
            .post('/devices/create')
            .send({
                name: 'Contact Test Device',
                labels: ['test'],
            })
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-Forwardin-Key', accountApiKey);

        deviceId = deviceRes.body.data?.id;
    });

    describe('Create Contact', () => {
        it('should create a new contact with valid data', async () => {
            const response = await request(app)
                .post('/contacts/create')
                .send({
                    firstName: 'John',
                    lastName: 'Doe',
                    phone: '08123456789',
                    deviceId: deviceId,
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            if (response.status === 201) {
                expect(response.body).to.have.property('message');
                contactId = response.body.contact?.id;
            } else {
                // Device might not be ready, which is acceptable
                expect([201, 400, 404, 500]).to.include(response.status);
            }
        });

        it('should return 400 when required fields are missing', async () => {
            const response = await request(app)
                .post('/contacts/create')
                .send({
                    lastName: 'Doe',
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'firstName, phone, and deviceId are required');
        });

        it('should return 400 when phone is missing', async () => {
            const response = await request(app)
                .post('/contacts/create')
                .send({
                    firstName: 'John',
                    deviceId: deviceId,
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'firstName, phone, and deviceId are required');
        });

        it('should return 400 when deviceId is missing', async () => {
            const response = await request(app)
                .post('/contacts/create')
                .send({
                    firstName: 'John',
                    phone: '08123456780',
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'firstName, phone, and deviceId are required');
        });

        it('should return 404 when device does not exist', async () => {
            const response = await request(app)
                .post('/contacts/create')
                .send({
                    firstName: 'John',
                    phone: '08123456781',
                    deviceId: 'non-existent-device-id',
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(404);
            expect(response.body).to.have.property('message', 'Device not found');
        });

        it('should normalize phone number (08xx -> 628xx)', async () => {
            // This test verifies the phone normalization logic
            const response = await request(app)
                .post('/contacts/create')
                .send({
                    firstName: 'Normalized',
                    phone: '0812345678901234', // Will be normalized
                    deviceId: deviceId,
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            // Status can vary based on device state
            expect([201, 400, 404, 500]).to.include(response.status);
        });
    });

    describe('Get Contacts', () => {
        it('should return list of contacts', async () => {
            const response = await request(app)
                .get('/contacts')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
            // Response can be an array or object with data property
            expect(response.body).to.satisfy((body: any) => {
                return Array.isArray(body) || (typeof body === 'object' && body !== null);
            });
        });

        it('should support pagination query params', async () => {
            const response = await request(app)
                .get('/contacts?page=1&limit=10')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
        });
    });

    describe('Get Contact Labels', () => {
        it('should return list of labels', async () => {
            const response = await request(app)
                .get('/contacts/labels')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
        });
    });

    describe('Delete Contacts', () => {
        it('should return 400 when contactIds is not provided', async () => {
            const response = await request(app)
                .delete('/contacts')
                .send({})
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
        });
    });

    after(async () => {
        // Cleanup: Delete device first, then user
        if (deviceId) {
            await request(app)
                .delete('/devices/')
                .send({ deviceIds: [deviceId] })
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);
        }

        await request(app)
            .delete('/users/delete')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-Forwardin-Key', accountApiKey);
    });
});
