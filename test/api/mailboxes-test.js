/*eslint no-unused-expressions: 0, prefer-arrow-callback: 0, no-console:0 */

/* globals before: false, after: false */

'use strict';

const supertest = require('supertest');
const chai = require('chai');

const expect = chai.expect;
chai.config.includeStack = true;
const config = require('wild-config');

const server = supertest.agent(`http://127.0.0.1:${config.api.port}`);

describe('Storage tests', function () {
    this.timeout(10000); // eslint-disable-line no-invalid-this

    let user;

    before(async () => {
        // ensure that we have an existing user account
        const response = await server
            .post('/users')
            .send({
                username: 'storageuser',
                password: 'secretvalue',
                address: 'storageuser.addrtest@example.com',
                name: 'storage user'
            })
            .expect(200);
        expect(response.body.success).to.be.true;
        expect(response.body.id).to.exist;

        user = response.body.id;
    });

    after(async () => {
        if (!user) {
            return;
        }

        const response = await server.delete(`/users/${user}`).expect(200);
        expect(response.body.success).to.be.true;

        user = false;
    });

    it('should POST /users/{user}/mailboxes expect success / all data', async () => {
        const response = await server.post(`/users/${user}/mailboxes`).send({ path: '/coolpath/abcda', hidden: false, retention: 0 }).expect(200);

        expect(response.body.success).to.be.true;
        expect(response.body.id).to.not.be.empty;
    });

    it('should POST /users/{user}/mailboxes expect success / hidden and retention fields missing', async () => {
        const response = await server.post(`/users/${user}/mailboxes`).send({ path: '/coolpath/abcdad' }).expect(200);

        expect(response.body.success).to.be.true;
        expect(response.body.id).to.not.be.empty;
    });

    it('should POST /users/{user}/mailboxes expect success / longer path with number', async () => {
        const response = await server
            .post(`/users/${user}/mailboxes`)
            .send({ path: '/cool2/path2/whatisthis346/cool-drink', hidden: false, retention: 0 })
            .expect(200);

        expect(response.body.success).to.be.true;
        expect(response.body.id).to.not.be.empty;
    });

    it('should POST /users/{user}/mailboxes expect failure / retention negative', async () => {
        const response = await server
            .post(`/users/${user}/mailboxes`)
            .send({ path: '/cool2/path2/whatisthis346/cool-drink', hidden: false, retention: -1 })
            .expect(400);

        expect(response.body.code).to.be.equal('InputValidationError');
        expect(response.body.error).to.not.be.empty;
    });

    it('should POST /users/{user}/mailboxes expect failure / retention is string', async () => {
        const response = await server
            .post(`/users/${user}/mailboxes`)
            .send({ path: '/cool2/path2/whatisthis346/cool-drink', hidden: false, retention: 'aaa' })
            .expect(400);

        expect(response.body.code).to.be.equal('InputValidationError');
        expect(response.body.error).to.not.be.empty;
    });

    it('should POST /users/{user}/mailboxes expect failure / path contains double slash', async () => {
        const response = await server
            .post(`/users/${user}/mailboxes`)
            .send({ path: '/cool2//path2/whatisthis346///cool-drink', hidden: false, retention: 0 })
            .expect(400);

        expect(response.body.code).to.be.equal('InputValidationError');
        expect(response.body.error).to.not.be.empty;
    });

    it('should POST /users/{user}/mailboxes expect failure / user format incorrect', async () => {
        const response = await server
            .post(`/users/${123}/mailboxes`)
            .send({ path: '/cool2/path2/whatisthis346/cool-drink', hidden: false, retention: 0 })
            .expect(400);

        expect(response.body.code).to.be.equal('InputValidationError');
        expect(response.body.error).to.not.be.empty;
    });

    it('should POST /users/{user}/mailboxes expect failure / user format not hex', async () => {
        const response = await server
            .post(`/users/${'-'.repeat(24)}/mailboxes`)
            .send({ path: '/cool2/path2/whatisthis346/cool-drink', hidden: false, retention: 0 })
            .expect(400);

        expect(response.body.code).to.be.equal('InputValidationError');
        expect(response.body.error).to.not.be.empty;
    });

    // TODO: rewrite when mailboxes.js gets updated status codes
    it('should POST /users/{user}/mailboxes expect failure / user not found', async () => {
        const response = await server
            .post(`/users/${'0'.repeat(24)}/mailboxes`)
            .send({ path: '/cool2/path2/whatisthis346/cool-drink', hidden: false, retention: 0 })
            .expect(500);

        expect(response.body.error).to.be.equal('User not found');
    });

    it('should POST /users/{user}/mailboxes expect failure / path is missing', async () => {
        const response = await server.post(`/users/${user}/mailboxes`).send({ path: undefined, hidden: false, retention: 'aaa' }).expect(400);

        expect(response.body.code).to.be.equal('InputValidationError');
        expect(response.body.error).to.not.be.empty;
    });

    it('should GET /users/{user}/mailboxes expect success', async () => {
        const response = await server.get(`/users/${user}/mailboxes`).send({}).expect(200);

        expect(response.body.success).to.be.true;
        expect(response.body.results).to.not.be.empty;
        expect(response.body.results.length).to.be.equal(8);
    });

    it('should GET /users/{user}/mailboxes expect success / all params', async () => {
        const response = await server.get(`/users/${user}/mailboxes`).send({ specialUse: true, showHidden: true, counters: true, sizes: true }).expect(200);

        expect(response.body.success).to.be.true;
        expect(response.body.results).to.not.be.empty;
        expect(response.body.results.length).to.be.equal(8);
    });

    it('should GET /users/{user}/mailboxes expect success / some params', async () => {
        const response = await server.get(`/users/${user}/mailboxes`).send({ specialUse: false, counters: true, sizes: true }).expect(200);

        expect(response.body.success).to.be.true;
    });

    it('should GET /users/{user}/mailboxes expect success / params incorrect type', async () => {
        const response = await server.get(`/users/${user}/mailboxes`).send({ specialUse: 'what', showHidden: 111, counters: -2, sizes: 'sizes' }).expect(200);

        expect(response.body.success).to.be.true;
        expect(response.body.results).to.not.be.empty;
        expect(response.body.results.length).to.be.equal(8);
    });

    it('should GET /users/{user}/mailboxes expect failure / user wrong format', async () => {
        const response = await server.get(`/users/${123}/mailboxes`).send({ specialUse: true, showHidden: true, counters: true, sizes: true }).expect(400);

        expect(response.body.code).to.be.equal('InputValidationError');
        expect(response.body.error).to.not.be.empty;
    });

    it('should GET /users/{user}/mailboxes expect failure / user not found', async () => {
        const response = await server
            .get(`/users/${'0'.repeat(24)}/mailboxes`)
            .send({ specialUse: false, counters: true, sizes: true })
            .expect(404);

        expect(response.body.error).to.be.equal('This user does not exist');
        expect(response.body.code).to.be.equal('UserNotFound');
    });
});
