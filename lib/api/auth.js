'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema } = require('../schemas');

module.exports = (db, server, userHandler) => {
    server.post(
        '/authenticate',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                username: Joi.alternatives()
                    .try(
                        Joi.string()
                            .lowercase()
                            .regex(/^[a-z0-9][a-z0-9.]+[a-z0-9]$/, 'username')
                            .min(3)
                            .max(30),
                        Joi.string().email({ tlds: false })
                    )
                    .required(),
                password: Joi.string().max(256).required(),

                protocol: Joi.string().default('API'),
                scope: Joi.string()
                    .default('master')
                    // token can be true only if scope is master
                    .when('token', { is: true, then: Joi.valid('master') }),

                appId: Joi.string().empty('').uri(),

                token: booleanSchema.default(false),

                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
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

            let permission = roles.can(req.role).createAny('authentication');

            // permissions check
            req.validate(permission);

            // filter out unallowed fields
            result.value = permission.filter(result.value);

            let meta = {
                protocol: result.value.protocol,
                sess: result.value.sess,
                ip: result.value.ip
            };

            if (result.value.appId) {
                meta.appId = result.value.appId;
            }

            let authData, user;

            try {
                [authData, user] = await userHandler.asyncAuthenticate(result.value.username, result.value.password, result.value.scope, meta);
            } catch (err) {
                let response = {
                    error: err.message,
                    code: 'AuthFailed' || err.code
                };
                if (user) {
                    response.id = user.toString();
                }
                res.status(403);
                res.json(response);
                return next();
            }

            if (!authData) {
                let response = {
                    error: 'Authentication failed',
                    code: 'AuthFailed'
                };
                if (user) {
                    response.id = user.toString();
                }
                res.status(403);
                res.json(response);
                return next();
            }

            let authResponse = {
                success: true,
                id: authData.user.toString(),
                username: authData.username,
                scope: authData.scope,
                require2fa: authData.require2fa,
                requirePasswordChange: authData.requirePasswordChange
            };

            if (result.value.token) {
                try {
                    authResponse.token = await userHandler.generateAuthToken(authData.user);
                } catch (err) {
                    let response = {
                        error: err.message,
                        code: err.code || 'AuthFailed',
                        id: user.toString()
                    };
                    res.status(403);
                    res.json(response);
                    return next();
                }
            }

            if (authData.u2fAuthRequest) {
                authResponse.u2fAuthRequest = authData.u2fAuthRequest;
            }

            res.status(200);
            res.json(permission.filter(authResponse));
            return next();
        })
    );

    server.del(
        '/authenticate',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            if (req.accessToken) {
                try {
                    await db.redis
                        .multi()
                        .del('tn:token:' + req.accessToken.hash)
                        .exec();
                } catch (err) {
                    // ignore
                }
            }

            res.json({ success: true });
            return next();
        })
    );

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
};
