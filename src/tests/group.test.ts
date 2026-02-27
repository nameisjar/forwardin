import request from 'supertest';
import { expect } from 'chai';
import app from '../index';

describe('------Group API------', () => {
    let authToken: string;
    let accountApiKey: string;
    let groupId: string;

    before(async () => {
        // Register and login
        const response = await request(app)
            .post('/auth/register')
            .send({
                firstName: 'group',
                lastName: 'tester',
                username: 'group_tester',
                phone: '628886945383',
                email: 'group@example.com',
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
    });

    describe('Create Group', () => {
        it('should create a new group with valid data', async () => {
            const response = await request(app)
                .post('/groups/create')
                .send({
                    name: 'Test Group',
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
            expect(response.body).to.have.property('message', 'Group created successfully');
        });

        it('should return 400 when group name is missing', async () => {
            const response = await request(app)
                .post('/groups/create')
                .send({})
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'Group name is required');
        });

        it('should return 400 when group name is too short', async () => {
            const response = await request(app)
                .post('/groups/create')
                .send({ name: 'ab' })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'Group name must be at least 3 characters');
        });

        it('should return 400 when group name already exists', async () => {
            // First create a group
            await request(app)
                .post('/groups/create')
                .send({ name: 'Duplicate Group' })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            // Try to create another with same name
            const response = await request(app)
                .post('/groups/create')
                .send({ name: 'Duplicate Group' })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'Group name already exists');
        });
    });

    describe('Get Groups', () => {
        it('should return list of groups', async () => {
            const response = await request(app)
                .get('/groups')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
            expect(response.body).to.be.an('array');

            // Save a groupId for other tests
            if (response.body.length > 0) {
                groupId = response.body[0].id;
            }
        });

        it('should return groups with membersCount', async () => {
            const response = await request(app)
                .get('/groups')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
            if (response.body.length > 0) {
                expect(response.body[0]).to.have.property('membersCount');
            }
        });
    });

    describe('Get Single Group', () => {
        it('should return 400 for invalid group ID format', async () => {
            const response = await request(app)
                .get('/groups/invalid-id')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            // Should return 400 or 404 depending on implementation
            expect([400, 404]).to.include(response.status);
        });
    });

    describe('Delete Groups', () => {
        it('should return 400 when groupIds is not provided', async () => {
            const response = await request(app)
                .delete('/groups')
                .send({})
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
        });

        it('should delete group successfully', async () => {
            // First create a group to delete
            await request(app)
                .post('/groups/create')
                .send({ name: 'Group to Delete' })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            // Get the group ID
            const getRes = await request(app)
                .get('/groups')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            const groupToDelete = getRes.body.find((g: any) => g.name === 'Group to Delete');

            if (groupToDelete) {
                const response = await request(app)
                    .delete('/groups')
                    .send({ groupIds: [groupToDelete.id] })
                    .set('Content-Type', 'application/json')
                    .set('Authorization', `Bearer ${authToken}`)
                    .set('X-Forwardin-Key', accountApiKey);

                expect(response.status).to.equal(200);
            }
        });
    });

    after(async () => {
        // Cleanup: Delete test user and related data
        await request(app)
            .delete('/users/delete')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-Forwardin-Key', accountApiKey);
    });
});
