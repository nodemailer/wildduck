'use strict';

const Boom = require('@hapi/boom');
const Hoek = require('@hapi/hoek');
const Joi = require('joi');

// Declare Internals

const internals = {};

internals.defaults = {
    accessTokenName: 'accessToken',
    unauthorized: Boom.unauthorized
};

internals.schema = Joi.object().keys({
    validate: Joi.func().required(),
    accessTokenName: Joi.string().required(),
    unauthorized: Joi.func()
});

internals.implementation = (server, options) => {
    Hoek.assert(options, 'Missing access token auth strategy options');

    const settings = Hoek.applyToDefaults(internals.defaults, options);
    Joi.assert(settings, internals.schema);

    const scheme = {
        authenticate: async (request, h) => {
            let token = request.raw.req.headers['x-access-token'];

            if (!token && request.app[settings.accessTokenName]) {
                token = request.app[settings.accessTokenName];
            }

            token = (token || '').toString().trim();

            const { status, credentials, artifacts } = await settings.validate(request, token, h);

            if (status === 'missing') {
                return settings.unauthorized(null, 'AccessToken');
            }

            if (status === 'fail') {
                return h.unauthenticated(settings.unauthorized('Bad access token', settings.tokenType), { credentials: credentials || {}, artifacts });
            }

            if (!credentials || typeof credentials !== 'object') {
                return h.unauthenticated(Boom.badImplementation('Bad access token string received for auth validation'), { credentials: {} });
            }

            return h.authenticated({ credentials, artifacts });
        }
    };

    return scheme;
};

exports.plugin = {
    name: 'AccessTokenAuth',
    version: '1.0.0',
    register: server => server.auth.scheme('access-token', internals.implementation)
};
