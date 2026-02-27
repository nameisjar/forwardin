import request from 'supertest';
import { expect } from 'chai';
import app from '../index';
import prisma from '../utils/db';

describe('------Template API------', () => {
    let authToken: string;
    let accountApiKey: string;
    let userId: string;
    let templateId: string;

    before(async () => {
        // Register and login
        const response = await request(app)
            .post('/auth/register')
            .send({
                firstName: 'template',
                lastName: 'tester',
                username: 'template_tester',
                phone: '628886945382',
                email: 'template@example.com',
                password: 'P4$sword!!!',
                confirmPassword: 'P4$sword!!!',
            })
            .set('Content-Type', 'application/json');

        authToken = response.body.accessToken;
        accountApiKey = response.body.accountApiKey;

        // Get user ID
        const user = await prisma.user.findUnique({
            where: { email: 'template@example.com' },
        });
        userId = user?.id || '';

        // Activate trial subscription
        await request(app)
            .post('/payment/trial')
            .send({})
            .set('Content-Type', 'application/json')
            .set('Authorization', `Bearer ${authToken}`)
            .set('X-Forwardin-Key', accountApiKey);
    });

    describe('Create Template', () => {
        it('should create a new template with valid data', async () => {
            const response = await request(app)
                .post('/templates')
                .send({
                    name: 'Test Template',
                    message: 'Hello {{name}}, this is a test message!',
                    userId: userId,
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(201);
            expect(response.body).to.have.property('message', 'Template created successfully');
            expect(response.body).to.have.property('template');
            expect(response.body.template).to.have.property('name', 'Test Template');
            templateId = response.body.template.id;
        });

        it('should return 404 when userId is invalid', async () => {
            const response = await request(app)
                .post('/templates')
                .send({
                    name: 'Invalid Template',
                    message: 'Test message',
                    userId: 'non-existent-user-id',
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(404);
            expect(response.body).to.have.property('message', 'User not found');
        });
    });

    describe('Get Templates', () => {
        it('should return list of templates', async () => {
            const response = await request(app)
                .get('/templates')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
            expect(response.body).to.be.an('array');
        });
    });

    describe('Delete Templates', () => {
        it('should return 400 when templateIds is not provided', async () => {
            const response = await request(app)
                .delete('/templates')
                .send({})
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'templateIds must be a non-empty array');
        });

        it('should return 400 when templateIds is empty array', async () => {
            const response = await request(app)
                .delete('/templates')
                .send({ templateIds: [] })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'templateIds must be a non-empty array');
        });

        it('should return 400 when templateIds contains invalid types', async () => {
            const response = await request(app)
                .delete('/templates')
                .send({ templateIds: [123, null] })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(400);
            expect(response.body).to.have.property('message', 'All templateIds must be non-empty strings');
        });

        it('should delete template successfully', async () => {
            // First create a template to delete
            const createRes = await request(app)
                .post('/templates')
                .send({
                    name: 'Template to Delete',
                    message: 'This will be deleted',
                    userId: userId,
                })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            const deleteTemplateId = createRes.body.template.id;

            const response = await request(app)
                .delete('/templates')
                .send({ templateIds: [deleteTemplateId] })
                .set('Content-Type', 'application/json')
                .set('Authorization', `Bearer ${authToken}`)
                .set('X-Forwardin-Key', accountApiKey);

            expect(response.status).to.equal(200);
            expect(response.body).to.have.property('message', 'Template(s) deleted successfully');
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
