/*eslint no-unused-expressions: 0, prefer-arrow-callback: 0, no-console:0 */
/* globals before: false, after: false */

'use strict';

const supertest = require('supertest');
const chai = require('chai');

const expect = chai.expect;
chai.config.includeStack = true;

const server = supertest.agent('http://localhost:8080');

describe('API tests', function() {
    let userId, asp, address, inbox;

    this.timeout(10000); // eslint-disable-line no-invalid-this

    before(async () => {
        // ensure that we have an existing user account
        const response = await server
            .post('/users')
            .send({
                username: 'testuser',
                password: 'secretpass',
                address: 'testuser@example.com',
                name: 'test user'
            })
            .expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.id).to.exist;

        userId = response.body.id;
    });

    after(async () => {
        if (!userId) {
            return;
        }

        const response = await server.delete(`/users/${userId}`).expect(200);
        expect(response.body.success).to.be.true;

        userId = false;
    });

    it('should POST /domainaliases', async () => {
        const response = await server
            .post('/domainaliases')
            .send({
                alias: 'jõgeva.öö',
                domain: 'example.com'
            })
            .expect(200);
        expect(response.body.success).to.be.true;
    });

    it('should GET /users/:user', async () => {
        const response = await server.get(`/users/${userId}`).expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.id).to.equal(userId);
        expect(response.body.name).to.equal('test user');
    });

    it('should PUT /users/:user', async () => {
        const response = await server
            .put(`/users/${userId}`)
            .send({
                name: 'user test'
            })
            .expect(200);
        expect(response.body.success).to.be.true;
    });

    it('should GET /users/:user (updated name)', async () => {
        const response = await server.get(`/users/${userId}`).expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.id).to.equal(userId);
        expect(response.body.name).to.equal('user test');
    });

    it('should POST /authenticate with success', async () => {
        const response = await server
            .post(`/authenticate`)
            .send({
                username: 'testuser@example.com',
                password: 'secretpass',
                scope: 'master'
            })
            .expect(200);
        expect(response.body.success).to.be.true;
    });

    it('should POST /authenticate with failure', async () => {
        const response = await server
            .post(`/authenticate`)
            .send({
                username: 'testuser@example.com',
                password: 'invalid',
                scope: 'master'
            })
            .expect(403);
        expect(response.body.error).to.exist;
        expect(response.body.success).to.not.be.true;
    });

    it('should POST /authenticate using alias domain', async () => {
        const response = await server
            .post(`/authenticate`)
            .send({
                username: 'testuser@jõgeva.öö',
                password: 'secretpass',
                scope: 'master'
            })
            .expect(200);
        expect(response.body.success).to.be.true;
    });

    it('should POST /authenticate with failure using alias domain', async () => {
        const response = await server
            .post(`/authenticate`)
            .send({
                username: 'testuser@jõgeva.öö',
                password: 'invalid',
                scope: 'master'
            })
            .expect(403);
        expect(response.body.error).to.exist;
        expect(response.body.success).to.not.be.true;
    });

    it('should POST /users/:user/asps to generate ASP', async () => {
        const response = await server
            .post(`/users/${userId}/asps`)
            .send({
                description: 'test',
                scopes: ['imap', 'smtp'],
                generateMobileconfig: true
            })
            .expect(200);
        expect(response.body.error).to.not.exist;
        expect(response.body.success).to.be.true;
        expect(response.body.password).to.exist;
        expect(response.body.mobileconfig).to.exist;

        asp = response.body.password;
    });

    it('should POST /authenticate using ASP and allowed scope', async () => {
        const response = await server
            .post(`/authenticate`)
            .send({
                username: 'testuser@jõgeva.öö',
                password: asp,
                scope: 'imap'
            })
            .expect(200);
        expect(response.body.success).to.be.true;
    });

    it('should POST /authenticate with failure using ASP and master scope', async () => {
        const response = await server
            .post(`/authenticate`)
            .send({
                username: 'testuser@jõgeva.öö',
                password: asp,
                scope: 'master'
            })
            .expect(403);
        expect(response.body.error).to.exist;
        expect(response.body.success).to.not.be.true;
    });

    it('should GET /users/:user/addresses', async () => {
        const response = await server.get(`/users/${userId}/addresses`).expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.results.length).to.equal(1);
        expect(response.body.results[0].address).to.equal('testuser@example.com');
        expect(response.body.results[0].main).to.be.true;
    });

    it('should POST users/:user/addresses', async () => {
        const response1 = await server
            .post(`/users/${userId}/addresses`)
            .send({
                address: 'alias1@example.com',
                main: true
            })
            .expect(200);
        expect(response1.body.success).to.be.true;

        const response2 = await server
            .post(`/users/${userId}/addresses`)
            .send({
                address: 'alias2@example.com'
            })
            .expect(200);
        expect(response2.body.success).to.be.true;
    });

    it('should GET /users/:user (after email update', async () => {
        const response = await server.get(`/users/${userId}`).expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.id).to.equal(userId);
        expect(response.body.address).to.equal('alias1@example.com');
    });

    it('should GET /users/:user/addresses (updated listing)', async () => {
        const response = await server.get(`/users/${userId}/addresses`).expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.results.length).to.equal(3);
        response.body.results.sort((a, b) => a.id.localeCompare(b.id));

        expect(response.body.results[0].address).to.equal('testuser@example.com');
        expect(response.body.results[0].main).to.be.false;

        expect(response.body.results[1].address).to.equal('alias1@example.com');
        expect(response.body.results[1].main).to.be.true;

        expect(response.body.results[2].address).to.equal('alias2@example.com');
        expect(response.body.results[2].main).to.be.false;

        address = response.body.results[2];
    });

    it('should DELETE users/:user/addresses/:address', async () => {
        const response = await server.delete(`/users/${userId}/addresses/${address.id}`).expect(200);
        expect(response.body.success).to.be.true;
    });

    it('should GET /users/:user/addresses (after DELETE)', async () => {
        const response = await server.get(`/users/${userId}/addresses`).expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.results.length).to.equal(2);
        response.body.results.sort((a, b) => a.id.localeCompare(b.id));

        expect(response.body.results[0].address).to.equal('testuser@example.com');
        expect(response.body.results[0].main).to.be.false;

        expect(response.body.results[1].address).to.equal('alias1@example.com');
        expect(response.body.results[1].main).to.be.true;
    });

    it('should GET /users/:user/mailboxes', async () => {
        const response = await server.get(`/users/${userId}/mailboxes`).expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.results.length).to.gte(4);

        inbox = response.body.results.find(result => result.path === 'INBOX');
        expect(inbox).to.exist;
    });
});
