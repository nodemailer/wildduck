'use strict';

const Joi = require('joi');
const Boom = require('@hapi/boom');
const AcmeChallenge = require('../acme/acme-challenge');
const { getHostname, normalizeIp, failAction } = require('../tools');

module.exports = (server, db) => {
    const acmeChallenge = AcmeChallenge.create({ db: db.database });

    server.route({
        method: 'GET',
        path: '/.well-known/acme-challenge/{token}',

        async handler(request, h) {
            const ip = normalizeIp(request.app.remoteAddress);
            const domain = getHostname(request);

            const token = request.params.token;

            let challenge;
            try {
                challenge = await acmeChallenge.get({
                    challenge: {
                        token,
                        identifier: { value: domain }
                    }
                });
            } catch (err) {
                request.logger.error({ api: 'acme', msg: 'Error verifying challenge', domain, token, ip, err });

                let error = Boom.boomify(new Error('Failed to verify authentication token'), { statusCode: 500 });
                if (err.code) {
                    error.output.payload.code = err.code;
                }
                throw error;
            }

            if (!challenge || !challenge.keyAuthorization) {
                request.logger.error({ api: 'acme', msg: 'Unknown challenge', domain, token, ip });

                let error = Boom.boomify(new Error('Unknown challenge'), { statusCode: 404 });
                error.output.payload.code = 'UnknownAcmeChallenge';
                throw error;
            }

            return h.response(challenge.keyAuthorization).type('text/plain').charset('utf-8').code(200);
        },

        options: {
            description: 'Return ACME challenge',
            notes: 'Respond to an ACME verification query with the challenge value',
            tags: ['well-known', 'acme'],

            plugins: {},

            auth: false,

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    token: Joi.string().empty('').max(256).required().label('AcmeToken')
                }).label('GetAcmeChallenge')
            }
        }
    });
};
