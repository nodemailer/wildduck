'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema } = require('../schemas');

module.exports = (db, server) => {
    /**
     * @api {get} /users List registered Webhooks
     * @apiName GetWebhooks
     * @apiGroup Webhooks
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} type Prefix or exact match. Prefix match must end with `".*"`, eg `"channel.*"`. Use `"*"` for all types
     * @apiParam {String} [user] User ID
     * @apiParam {Number} [limit=20] How many records to return
     * @apiParam {Number} [page=1] Current page number. Informational only, page numbers start from 1
     * @apiParam {Number} [next] Cursor value for next page, retrieved from <code>nextCursor</code> response value
     * @apiParam {Number} [previous] Cursor value for previous page, retrieved from <code>previousCursor</code> response value
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Number} total How many results were found
     * @apiSuccess {Number} page Current page number. Derived from <code>page</code> query argument
     * @apiSuccess {String} previousCursor Either a cursor string or false if there are not any previous results
     * @apiSuccess {String} nextCursor Either a cursor string or false if there are not any next results
     * @apiSuccess {Object[]} results Webhook listing
     * @apiSuccess {String} results.id Webhooks unique ID (24 byte hex)
     * @apiSuccess {String[]} results.type An array of event types this webhook matches
     * @apiSuccess {String} results.user User ID or null
     * @apiSuccess {String} results.url Webhook URL
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/webhooks
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "total": 1,
     *       "page": 1,
     *       "previousCursor": false,
     *       "nextCursor": false,
     *       "results": [
     *         {
     *           "id": "59cb948ad80a820b68f05230",
     *           "type": ["dkim.updated", "user.*"],
     *           "user": null,
     *           "url": "https://98f7ab80593b966da1fc1cf58ff79046.m.pipedream.net"
     *         }
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
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
            if (!permission.granted && req.user && ObjectID.isValid(req.user)) {
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

            let user = result.value.user ? new ObjectID(result.value.user) : null;
            if (ownOnly) {
                user = new ObjectID(req.user);
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

    /**
     * @api {post} /webhooks Create new Webhook
     * @apiName PostWebhook
     * @apiGroup Webhooks
     * @apiDescription Create new webhook
     *
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String[]} type An array of event types to match. For prefix match use `".*"` at the end (eg. `"user.*"`) or `"*"` for all types
     * @apiParam {String} [user] User ID to match (only makes sense for user specific resources)
     * @apiParam {String} url URL to POST data to
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Address
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/webhooks \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "type": ["dkim.created", "user.*"],
     *       "url": "https://98f7ab80593b966da1fc1cf58ff79046.m.pipedream.net"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e81"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database connection failed"
     *     }
     */
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
            let user = result.value.user ? new ObjectID(result.value.user) : null;
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
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!userData) {
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

    /**
     * @api {delete} /webhooks/:webhook Delete a webhook
     * @apiName DeleteWebhook
     * @apiGroup Webhooks
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} webhook ID of the Webhook
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/webhooks/59ef21aef255ed1d9d790e81
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This webhook does not exist"
     *     }
     */
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

            let webhook = new ObjectID(result.value.webhook);

            let webhookData;
            try {
                webhookData = await db.users.collection('webhooks').findOne({
                    _id: webhook
                });
            } catch (err) {
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
