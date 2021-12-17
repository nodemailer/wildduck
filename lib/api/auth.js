'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const { failAction } = require('../tools');
const Boom = require('@hapi/boom');
const roles = require('../roles');
const {
    nextPageCursorSchema,
    previousPageCursorSchema,
    pageNrSchema,
    sessSchema,
    sessIPSchema,
    booleanSchema,
    usernameSchema,
    userIdSchema,
    mongoIdSchema
} = require('../schemas');

module.exports = (server, db, userHandler) => {
    server.route({
        method: 'POST',
        path: '/authenticate',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).createAny('authentication');
            request.validateAcl(permission);

            // filter out unallowed fields
            request.payload = permission.filter(request.payload);

            let meta = {};

            for (let key of ['protocol', 'sess', 'ip', 'appId']) {
                if (request.payload[key]) {
                    meta[key] = request.payload[key];
                }
            }

            let authData, user;

            try {
                [authData, user] = await userHandler.asyncAuthenticate(request.payload.username, request.payload.password, request.payload.scope, meta);
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: 403 });
                error.output.payload.code = 'AuthFailed' || err.code;
                if (user) {
                    error.output.payload.id = user.toString();
                }
                throw error;
            }

            if (!authData) {
                let error = Boom.boomify(new Error('Authentication failed'), { statusCode: 403 });
                error.output.payload.code = 'AuthFailed';
                if (user) {
                    error.output.payload.id = user.toString();
                }
                throw error;
            }

            let authResponse = {
                success: true,
                id: authData.user.toString(),
                username: authData.username,
                scope: authData.scope,
                require2fa: authData.require2fa,
                requirePasswordChange: authData.requirePasswordChange
            };

            if (request.payload.token) {
                try {
                    authResponse.token = await userHandler.generateAuthToken(authData.user);
                } catch (err) {
                    let error = Boom.boomify(err, { statusCode: 403 });
                    error.output.payload.code = 'AuthFailed' || err.code;
                    if (user) {
                        error.output.payload.id = user.toString();
                    }
                    throw error;
                }
            }

            if (authData.u2fAuthRequest) {
                authResponse.u2fAuthRequest = authData.u2fAuthRequest;
            }

            return permission.filter(authResponse);
        },

        options: {
            description: 'Authenticate a User',
            notes: 'Authenticate a User by sending a username and a password',
            tags: ['api', 'Authentication'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                payload: Joi.object({
                    username: Joi.alternatives()
                        .try(usernameSchema, Joi.string().email({ tlds: false }))
                        .required()
                        .example('myuser')
                        .description('Username'),
                    password: Joi.string().max(256).required().example('verysecret').description('Username or E-mail address'),

                    protocol: Joi.string().default('API').example('API').description('Application identifier for security logs'),
                    scope: Joi.string()
                        .default('master')
                        // token can be true only if scope is master
                        .when('token', { is: true, then: Joi.valid('master') })
                        .example('master')
                        .description('Required scope. One of "master", "imap", "smtp", "pop3"'),

                    appId: Joi.string().empty('').uri().example('https://localhost:3000').description('Fully qualified HTTPS URL of your website for U2F'),

                    token: booleanSchema
                        .default(false)
                        .example(false)
                        .description(
                            'If true then generates a temporary access token that is valid for this user. Only available if scope is "master". When using user tokens then you can replace user ID in URLs with "me".'
                        ),

                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('CreateAuthenticationQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the authentication successful or not'),
                    id: userIdSchema.required().description('ID of the authenticated User'),
                    username: usernameSchema.required().description('Username of the authenticated User'),
                    scope: Joi.string().example('master').description('The scope this authentication is valid for'),
                    require2fa: Joi.array()
                        .allow(false)
                        .example(['totp'])
                        .description('List of enabled 2FA mechanisms valid for this user or `false` if 2FA is not enabled'),
                    requirePasswordChange: booleanSchema
                        .default(false)
                        .example(false)
                        .description('Indicates if account hassword has been reset and should be replaced'),

                    token: Joi.string()
                        .example('2eb0db2ca9181b3713f59359eaeeeb99043e94e8')
                        .description(
                            'If access token was requested then this is the value to use as access token when making API requests on behalf of logged in user.'
                        ),

                    u2fAuthRequest: Joi.object().description('Values for U2F transaction')
                }).label('AuthenticationReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/authenticate',

        async handler(request) {
            // No permissions needed

            if (!request.app.accessToken) {
                return { success: true, deleted: false };
            }

            let result;

            try {
                result = await db.redis.del('tn:token:' + request.app.accessToken.hash);
            } catch (err) {
                // ignore
            }

            return { success: true, deleted: !!result };
        },

        options: {
            description: 'Invalidate an authentication token',
            notes: 'Invalidates the active authentication token that is used to authenticate this request',
            tags: ['api', 'Authentication'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('DeleteAuthenticationQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not')
                }).label('DeleteAuthenticationReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/users/{user}/authlog',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).readOwn('authentication');
            } else {
                permission = roles.can(request.app.role).readAny('authentication');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);
            let limit = request.query.limit;

            let action = request.query.action;
            let filterIp = request.query.filterIp;

            let page = request.query.page;
            let pageNext = request.query.next;
            let pagePrevious = request.query.previous;

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            _id: true
                        }
                    }
                );
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let filter = { user };
            if (filterIp) {
                filter.ip = filterIp;
            }

            let total = await db.users.collection('authlog').countDocuments(filter);

            let opts = {
                limit,
                query: filter,
                sortAscending: false
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.users.collection('authlog'), opts);
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let response = {
                success: true,
                action,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(resultData => {
                    let response = {
                        id: (resultData._id || '').toString()
                    };
                    Object.keys(resultData).forEach(key => {
                        if (!['_id', 'user'].includes(key)) {
                            response[key] = resultData[key];
                        }
                    });
                    return response;
                })
            };

            return permission.filter(response);
        },

        options: {
            description: 'List authentication events',
            notes: 'List stored authentication events',
            tags: ['api', 'Authentication'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required()
                }).label('ListAuthenticationLogParams'),

                query: Joi.object({
                    action: Joi.string()
                        .trim()
                        .lowercase()
                        .empty('')
                        .max(100)
                        .example('authentication')
                        .description('Limit listing only to values with specific action value'),
                    filterIp: sessIPSchema.example('127.0.0.1').description('Limit listing only to values with specific IP address'),

                    limit: Joi.number().default(20).min(1).max(250).example(20),
                    next: nextPageCursorSchema,
                    previous: previousPageCursorSchema,
                    page: pageNrSchema,
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('ListAuthenticationLogQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().example('example.com').description('Partial hostname match'),
                    total: Joi.number().required().example(123).description('How many DKIM certificates wer found'),
                    page: Joi.number().required().example(1).description('Current response page'),
                    previousCursor: previousPageCursorSchema.allow(false),
                    nextCursor: nextPageCursorSchema.allow(false),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: Joi.string().hex().length(24).required().example('613b069b9a6cbad5ba18d552'),
                                key: Joi.string().required().example('mVJzraDuY/cCrKwU8f4Scw==').description('Grouping key for multiple similar events'),
                                action: Joi.string().required().example('authentication').description('Event type'),
                                events: Joi.number().required().example(1).description('How many similar events was logged'),

                                expires: Joi.string()
                                    .isoDate()
                                    .required()
                                    .example('2022-01-02T15:52:10.467Z')
                                    .description('When will be this record deleted from the authlog'),

                                appId: Joi.string().example('https://localhost:3000').description('Fully qualified HTTPS URL of the website for U2F'),

                                last: Joi.string().isoDate().required().example('2021-12-03T15:52:10.467Z').description('Last occurance of this event'),

                                protocol: Joi.string().example('API').description('Client type that requested authentication'),
                                requiredScope: Joi.string().example('master').description('Requested scope'),
                                result: Joi.string().valid('success', 'fail').required().example('success').description('What was the result of the event'),

                                source: Joi.string().valid('master', 'asp', 'temporary').example('master').description('What kind of password was used'),

                                created: Joi.string().isoDate().required().example('2021-11-23T12:11:37.642Z').description('Datestring of the Event time'),

                                ip: sessIPSchema,
                                sess: sessSchema
                            }).label('AuthenticationLogListItem')
                        )
                        .description('Result listing')
                        .label('AuthenticationLogListItems')
                }).label('ListAuthenticationLogQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/users/{user}/authlog/{event}',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).readOwn('authentication');
            } else {
                permission = roles.can(request.app.role).readAny('authentication');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);
            let event = new ObjectId(request.params.event);

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            _id: true
                        }
                    }
                );
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let filter = { _id: event, user };
            let eventData;
            try {
                eventData = await db.users.collection('authlog').findOne(filter);
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!eventData) {
                let error = Boom.boomify(new Error('Requested event was not found'), { statusCode: 404 });
                error.output.payload.code = 'EventNotFound';
                throw error;
            }

            let response = {
                success: true,
                id: eventData._id.toString()
            };

            Object.keys(eventData).forEach(key => {
                if (!['_id', 'user'].includes(key)) {
                    response[key] = eventData[key];
                }
            });

            return permission.filter(response);
        },

        options: {
            description: 'Request authentication event',
            notes: 'Request information of an authentication event',
            tags: ['api', 'Authentication'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required(),
                    event: mongoIdSchema.required().description('Event ID')
                }).label('GetAuthenticationLogParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('GetAuthenticationLogQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),

                    id: Joi.string().hex().length(24).required().example('613b069b9a6cbad5ba18d552'),
                    key: Joi.string().required().example('mVJzraDuY/cCrKwU8f4Scw==').description('Grouping key for multiple similar events'),
                    action: Joi.string().required().example('authentication').description('Event type'),
                    events: Joi.number().required().example(1).description('How many similar events was logged'),

                    expires: Joi.string()
                        .isoDate()
                        .required()
                        .example('2022-01-02T15:52:10.467Z')
                        .description('When will be this record deleted from the authlog'),

                    appId: Joi.string().example('https://localhost:3000').description('Fully qualified HTTPS URL of the website for U2F'),

                    last: Joi.string().isoDate().required().example('2021-12-03T15:52:10.467Z').description('Last occurance of this event'),

                    protocol: Joi.string().example('API').description('Client type that requested authentication'),
                    requiredScope: Joi.string().example('master').description('Requested scope'),
                    result: Joi.string().valid('success', 'fail').required().example('success').description('What was the result of the event'),

                    source: Joi.string().valid('master', 'asp', 'temporary').example('master').description('What kind of password was used'),

                    created: Joi.string().isoDate().required().example('2021-11-23T12:11:37.642Z').description('Datestring of the Event time'),

                    ip: sessIPSchema,
                    sess: sessSchema
                }).label('GetAuthenticationLogQueryReponse'),
                failAction: 'log'
            }
        }
    });
};
