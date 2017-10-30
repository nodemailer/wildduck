'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectID = require('mongodb').ObjectID;

module.exports = (db, server, userHandler) => {
    server.post('/authenticate', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            username: Joi.alternatives()
                .try(
                    Joi.string()
                        .lowercase()
                        .regex(/^[a-z](?:\.?[a-z0-9]+)*$/, 'username')
                        .min(3)
                        .max(30),
                    Joi.string().email()
                )
                .required(),
            password: Joi.string()
                .max(256)
                .required(),

            protocol: Joi.string().default('API'),
            scope: Joi.string().default('master'),

            sess: Joi.string().max(255),
            ip: Joi.string().ip({
                version: ['ipv4', 'ipv6'],
                cidr: 'forbidden'
            })
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message
            });
            return next();
        }

        let meta = {
            protocol: result.value.protocol,
            sess: result.value.sess,
            ip: result.value.ip
        };

        userHandler.authenticate(result.value.username, result.value.password, result.value.scope, meta, (err, authData) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!authData) {
                res.json({
                    error: 'Authentication failed'
                });
                return next();
            }

            let authResponse = {
                success: true,
                id: authData.user,
                username: authData.username,
                scope: authData.scope,
                require2fa: authData.require2fa,
                requirePasswordChange: authData.requirePasswordChange
            };

            if (authData.u2fAuthRequest) {
                authResponse.u2fAuthRequest = authData.u2fAuthRequest;
            }

            res.json(authResponse);

            return next();
        });
    });

    server.get({ name: 'authlog', path: '/users/:user/authlog' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            action: Joi.string()
                .trim()
                .lowercase()
                .empty('')
                .max(100),
            limit: Joi.number()
                .default(20)
                .min(1)
                .max(250),
            next: Joi.string()
                .empty('')
                .alphanum()
                .max(1024),
            previous: Joi.string()
                .empty('')
                .alphanum()
                .max(1024),
            page: Joi.number()
                .empty('')
                .default(1)
        });

        req.query.user = req.params.user;

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            allowUnknown: false
        });

        if (result.error) {
            res.json({
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let limit = result.value.limit;
        let action = result.value.action;
        let page = result.value.page;
        let pageNext = result.value.next;
        let pagePrevious = result.value.previous;

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                _id: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
                });
                return next();
            }

            let filter = action
                ? {
                    user,
                    action
                }
                : {
                    user
                };

            db.database.collection('authlog').count(filter, (err, total) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                let opts = {
                    limit,
                    query: filter,
                    sortAscending: false
                };

                if (pageNext) {
                    opts.next = pageNext;
                } else if (pagePrevious) {
                    opts.previous = pagePrevious;
                }

                MongoPaging.find(db.users.collection('authlog'), opts, (err, result) => {
                    if (err) {
                        res.json({
                            error: result.error.message
                        });
                        return next();
                    }

                    if (!result.hasPrevious) {
                        page = 1;
                    }

                    let response = {
                        success: true,
                        action,
                        total,
                        page,
                        previousCursor: result.hasPrevious ? result.previous : false,
                        nextCursor: result.hasNext ? result.next : false,
                        results: (result.results || []).map(resultData => {
                            let response = {
                                id: resultData._id
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
                });
            });
        });
    });
};
