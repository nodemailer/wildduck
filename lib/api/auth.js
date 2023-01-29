'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema } = require('../schemas');

module.exports = (db, server, userHandler) => {
    server.post(
        '/preauth',
        tools.responseWrapper(async (req, res) => {
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

                scope: Joi.string().default('master'),

                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
            }

            let permission = roles.can(req.role).createAny('authentication');

            // permissions check
            req.validate(permission);

            // filter out unallowed fields
            result.value = permission.filter(result.value);

            let authData, user;

            try {
                [authData, user] = await userHandler.preAuth(result.value.username, result.value.scope);
            } catch (err) {
                let response = {
                    error: err.message,
                    code: err.code || 'AuthFailed'
                };
                if (user) {
                    response.id = user.toString();
                }
                res.status(403);
                return res.json(response);
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
                return res.json(response);
            }

            let preAuthResponse = {
                success: true,
                id: authData.user.toString(),
                username: authData.username,
                scope: authData.scope,
                require2fa: authData.require2fa
            };

            res.status(200);
            return res.json(permission.filter(preAuthResponse));
        })
    );

    server.post(
        '/authenticate',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                    code: err.code || 'AuthFailed'
                };

                if (user) {
                    response.id = user.toString();
                }

                res.status(403);
                return res.json(response);
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
                return res.json(response);
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
                    return res.json(response);
                }
            }

            res.status(200);
            return res.json(permission.filter(authResponse));
        })
    );

    server.del(
        '/authenticate',
        tools.responseWrapper(async (req, res) => {
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

            return res.json({ success: true });
        })
    );

    server.get(
        { name: 'authlog', path: '/users/:user/authlog' },
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            if (!userData) {
                res.status(404);
                return res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
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

            return res.json(response);
        })
    );

    server.get(
        '/users/:user/authlog/:event',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            if (!userData) {
                res.status(404);
                return res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
            }

            let filter = { _id: event, user };
            let eventData;
            try {
                eventData = await db.users.collection('authlog').findOne(filter);
            } catch (err) {
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            if (!eventData) {
                res.status(404);
                return res.json({
                    error: 'Event was not found',
                    code: 'EventNotFound'
                });
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

            return res.json(response);
        })
    );
};
