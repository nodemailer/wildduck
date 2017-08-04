/*eslint no-unused-expressions: 0, prefer-arrow-callback: 0, no-console:0 */

'use strict';

const chai = require('chai');
const frisby = require('icedfrisby');

const expect = chai.expect;
chai.config.includeStack = true;

const URL = 'http://localhost:8080';

let userId = false;

frisby
    .create('POST users')
    .post(
        URL + '/users',
        {
            username: 'testuser',
            password: 'secretpass',
            address: 'testuser@example.com',
            name: 'test user'
        },
        { json: true }
    )
    .expectStatus(200)
    .afterJSON(response => {
        expect(response).to.exist;
        expect(response.success).to.be.true;
        userId = response.id;

        frisby
            .create('GET users/{id}')
            .get(URL + '/users/' + userId)
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
                expect(response.id).to.equal(userId);
                expect(response.name).to.equal('test user');
            })
            .toss();

        frisby
            .create('PUT users/{id}')
            .put(
                URL + '/users/' + userId,
                {
                    name: 'user test'
                },
                { json: true }
            )
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
            })
            .toss();

        frisby
            .create('GET users/{id} – updated name')
            .get(URL + '/users/' + userId)
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
                expect(response.id).to.equal(userId);
                expect(response.name).to.equal('user test');
            })
            .toss();

        frisby
            .create('GET users/{id}/addresses')
            .get(URL + '/users/' + userId + '/addresses')
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
                expect(response.results.length).to.equal(1);
                expect(response.results[0].address).to.equal('testuser@example.com');
                expect(response.results[0].main).to.be.true;
            })
            .toss();

        frisby
            .create('POST users/{id}/addresses')
            .post(
                URL + '/users/' + userId + '/addresses',
                {
                    address: 'alias1@example.com',
                    main: true
                },
                { json: true }
            )
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
            })
            .toss();

        frisby
            .create('POST users/{id}/addresses')
            .post(
                URL + '/users/' + userId + '/addresses',
                {
                    address: 'alias2@example.com'
                },
                { json: true }
            )
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
            })
            .toss();

        frisby
            .create('GET users/{id}/addresses – updated listing')
            .get(URL + '/users/' + userId + '/addresses')
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
                expect(response.results.length).to.equal(3);
                response.results.sort((a, b) => a.id.localeCompare(b.id));

                expect(response.results[0].address).to.equal('testuser@example.com');
                expect(response.results[0].main).to.be.false;

                expect(response.results[1].address).to.equal('alias1@example.com');
                expect(response.results[1].main).to.be.true;

                expect(response.results[2].address).to.equal('alias2@example.com');
                expect(response.results[2].main).to.be.false;

                frisby
                    .create('DELETE users/{id}/addresses/{address}')
                    .delete(URL + '/users/' + userId + '/addresses/' + response.results[2].id)
                    .expectStatus(200)
                    .afterJSON(response => {
                        expect(response).to.exist;
                        expect(response.success).to.be.true;

                        frisby
                            .create('GET users/{id}/addresses – after DELETE')
                            .get(URL + '/users/' + userId + '/addresses')
                            .expectStatus(200)
                            .afterJSON(response => {
                                expect(response).to.exist;
                                expect(response.success).to.be.true;
                                expect(response.results.length).to.equal(2);
                            })
                            .toss();
                    })
                    .toss();
            })
            .toss();

        frisby
            .create('GET users/{id} – updated address')
            .get(URL + '/users/' + userId)
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
                expect(response.id).to.equal(userId);
                expect(response.address).to.equal('alias1@example.com');
            })
            .toss();

        frisby
            .create('GET users/{id}/mailboxes')
            .get(URL + '/users/' + userId + '/mailboxes')
            .expectStatus(200)
            .afterJSON(response => {
                expect(response).to.exist;
                expect(response.success).to.be.true;
                expect(response.results.length).to.be.gte(4);
                expect(response.results[0].path).to.equal('INBOX');
            })
            .toss();
    })
    .toss();
