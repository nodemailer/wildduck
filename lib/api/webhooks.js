'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema } = require('../schemas');

module.exports = (db, server) => {
    server.get(
        { name: 'webhooks', path: '/webhooks' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                type: Joi.string().empty('').lowercase().max(128),
                user: Joi.string().hex().lowercase().length(24),
                limit: Joi.number().default(20).min(1).max(250),
                next: nextPageCursorSchema,
                previous: previousPageCursorSchema,
                page: pageNrSchema,
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
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

            let permission;
            let ownOnly = false;
            permission = roles.can(req.role).readAny('webhooks');
            if (!permission.granted && req.user && ObjectId.isValid(req.user)) {
                permission = roles.can(req.role).readOwn('webhooks');
                if (permission.granted) {
                    ownOnly = true;
                }
            }
            // permissions check
            req.validate(permission);

            let query = {};

            if (result.value.type) {
                query.type = result.value.type;
            }

            let user = result.value.user ? new ObjectId(result.value.user) : null;
            if (ownOnly) {
                user = new ObjectId(req.user);
            }
            if (user) {
                query.user = user;
            }

            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let total = await db.users.collection('webhooks').countDocuments(query);

            let opts = {
                limit,
                query,
                fields: {
                    // FIXME: hack to keep _id in response
                    _id: true,
                    // FIXME: MongoPaging inserts fields value as second argument to col.find()
                    projection: {
                        _id: true,
                        type: true,
                        user: true,
                        url: true
                    }
                },
                // _id gets removed in response if not explicitly set in paginatedField
                paginatedField: '_id',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.users.collection('webhooks'), opts);
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
                type: result.value.type,
                user,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(webhookData => {
                    let values = {
                        id: webhookData._id.toString(),
                        type: webhookData.type,
                        user: webhookData.user ? webhookData.user.toString() : null,
                        url: webhookData.url
                    };

                    return permission.filter(values);
                })
            };

            res.json(response);
            return next();
        })
    );

    server.post(
        '/webhooks',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                type: Joi.array().items(Joi.string().trim().max(128).lowercase()).required(),
                user: Joi.string().hex().lowercase().length(24),
                url: Joi.string()
                    .uri({ scheme: [/smtps?/, /https?/], allowRelative: false, relativeOnly: false })
                    .required(),
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

            // permissions check
            let permission;
            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).createOwn('webhooks');
            } else {
                permission = roles.can(req.role).createAny('webhooks');
            }

            req.validate(permission);

            result.value = permission.filter(result.value);

            let type = result.value.type;
            let user = result.value.user ? new ObjectId(result.value.user) : null;
            let url = result.value.url;

            let userData;
            if (user) {
                try {
                    userData = await db.users.collection('users').findOne(
                        {
                            _id: user
                        },
                        {
                            projection: {
                                address: true
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
            }

            let webhookData = {
                type,
                user,
                url,
                created: new Date()
            };

            let r;
            // insert alias address to email address registry
            try {
                r = await db.users.collection('webhooks').insertOne(webhookData);
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            let insertId = r.insertedId;

            res.json({
                success: !!insertId,
                id: insertId
            });
            return next();
        })
    );

    server.del(
        '/webhooks/:webhook',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                webhook: Joi.string().hex().lowercase().length(24).required(),
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

            let webhook = new ObjectId(result.value.webhook);

            let webhookData;
            try {
                webhookData = await db.users.collection('webhooks').findOne({
                    _id: webhook
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            // permissions check
            if (req.user && webhookData && webhookData.user && req.user === webhookData.user.toString()) {
                req.validate(roles.can(req.role).deleteOwn('webhooks'));
            } else {
                req.validate(roles.can(req.role).deleteAny('webhooks'));
            }

            if (!webhookData) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown webhook identifier',
                    code: 'WebhookNotFound'
                });
                return next();
            }

            // delete address from email address registry
            let r;
            try {
                r = await db.users.collection('webhooks').deleteOne({
                    _id: webhook
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: !!r.deletedCount
            });
            return next();
        })
    );
};
