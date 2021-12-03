'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const { failAction } = require('../tools');
const Boom = require('@hapi/boom');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema, usernameSchema } = require('../schemas');

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
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552').description('ID of the authenticated User'),
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

    /*

    server.get(
        { name: 'authlog', path: '/users/:user/authlog' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                action: Joi.string().trim().lowercase().empty('').max(100),
                limit: Joi.number().default(20).min(1).max(250),
                next: nextPageCursorSchema,
                previous: previousPageCursorSchema,
                page: pageNrSchema,
                filterip: sessIPSchema,

                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: false
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('authentication'));
            } else {
                req.validate(roles.can(req.role).readAny('authentication'));
            }

            let user = new ObjectId(result.value.user);
            let limit = result.value.limit;

            let action = result.value.action;
            let ip = result.value.filterIp;

            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let filter = { user };
            if (ip) {
                filter.ip = ip;
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
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

            res.json(response);
            return next();
        })
    );

    server.get(
        '/users/:user/authlog/:event',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                event: Joi.string().hex().lowercase().length(24).required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: false
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('authentication'));
            } else {
                req.validate(roles.can(req.role).readAny('authentication'));
            }

            let user = new ObjectId(result.value.user);
            let event = new ObjectId(result.value.event);

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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let filter = { _id: event, user };
            let eventData;
            try {
                eventData = await db.users.collection('authlog').findOne(filter);
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!eventData) {
                res.status(404);
                res.json({
                    error: 'Event was not found',
                    code: 'EventNotFound'
                });
                return next();
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

            res.json(response);
            return next();
        })
    );
*/
};
