'use strict';

const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination-node6');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');

module.exports = (db, server) => {
    /**
     * @api {get} /addresses List registered Domain Aliases
     * @apiName GetAliases
     * @apiGroup Domain Aliases
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} [query] Partial match of a Domain Alias or Domain name
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
     * @apiSuccess {Object[]} results Aliases listing
     * @apiSuccess {String} results.id ID of the Domain Alias
     * @apiSuccess {String} results.alias Domain Alias
     * @apiSuccess {String} results.domain The domain this alias applies to
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/domainaliases
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
     *           "id": "59ef21aef255ed1d9d790e81",
     *           "alias": "example.net",
     *           "domain": "example.com"
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
    server.get({ name: 'domainaliases', path: '/domainaliases' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            query: Joi.string()
                .trim()
                .empty('')
                .max(255),
            limit: Joi.number()
                .default(20)
                .min(1)
                .max(250),
            next: Joi.string()
                .empty('')
                .mongoCursor()
                .max(1024),
            previous: Joi.string()
                .empty('')
                .mongoCursor()
                .max(1024),
            page: Joi.number().default(1)
        });

        const result = Joi.validate(req.query, schema, {
            abortEarly: false,
            convert: true,
            allowUnknown: true
        });

        if (result.error) {
            res.json({
                error: result.error.message
            });
            return next();
        }

        let query = result.value.query;
        let limit = result.value.limit;
        let page = result.value.page;
        let pageNext = result.value.next;
        let pagePrevious = result.value.previous;

        let filter = query
            ? {
                $or: [
                    {
                        alias: {
                            $regex: query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                            $options: ''
                        }
                    },

                    {
                        domain: {
                            $regex: query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                            $options: ''
                        }
                    }
                ]
            }
            : {};

        db.users.collection('domainaliases').count(filter, (err, total) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            let opts = {
                limit,
                query: filter,
                fields: {
                    _id: true,
                    alias: true,
                    domain: true
                },
                paginatedField: 'alias',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrevious) {
                opts.previous = pagePrevious;
            }

            MongoPaging.find(db.users.collection('domainaliases'), opts, (err, result) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                if (!result.hasPrevious) {
                    page = 1;
                }

                let response = {
                    success: true,
                    query,
                    total,
                    page,
                    previousCursor: result.hasPrevious ? result.previous : false,
                    nextCursor: result.hasNext ? result.next : false,
                    results: (result.results || []).map(domainData => ({
                        id: domainData._id.toString(),
                        alias: domainData.alias,
                        domain: domainData.domain
                    }))
                };

                res.json(response);
                return next();
            });
        });
    });

    /**
     * @api {post} /domainaliases/addresses Create new Domain Alias
     * @apiName PostDomainAlias
     * @apiGroup Domain Aliases
     * @apiDescription Add a new Alias for a Domain
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} alias Domain Alias
     * @apiParam {String} domain Domain name this Alias applies to
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Domain Alias
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/domainaliases \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "domain": "example.com",
     *       "alias": "example.org"
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
     *       "error": "This user does not exist"
     *     }
     */
    server.post('/domainaliases', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            alias: Joi.string()
                .hostname()
                .required(),
            domain: Joi.string()
                .hostname()
                .required()
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

        let alias = tools.normalizeDomain(req.params.alias);
        let domain = tools.normalizeDomain(req.params.domain);

        db.users.collection('domainaliases').findOne(
            {
                alias
            },
            (err, aliasData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }
                if (aliasData) {
                    res.json({
                        error: 'This domain alias already exists'
                    });
                    return next();
                }

                // insert alias address to email address registry
                db.users.collection('domainaliases').insertOne(
                    {
                        alias,
                        domain,
                        created: new Date()
                    },
                    (err, r) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message
                            });
                            return next();
                        }

                        let insertId = r.insertedId;

                        res.json({
                            success: !!insertId,
                            id: insertId
                        });
                        return next();
                    }
                );
            }
        );
    });

    /**
     * @api {get} /domainaliases/:alias Request Alias information
     * @apiName GetDomainAlias
     * @apiGroup Domain Aliases
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} alias ID of the Alias
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Alias
     * @apiSuccess {String} alias Alias domain
     * @apiSuccess {String} domain Alias target
     * @apiSuccess {String} created Datestring of the time the alias was created
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/domainaliases/59ef21aef255ed1d9d790e7a
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e7a",
     *       "alias": "example.net",
     *       "domain": "example.com",
     *       "created": "2017-10-24T11:19:10.911Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This Alias does not exist"
     *     }
     */
    server.get('/domainaliases/:alias', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            alias: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required()
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

        let alias = new ObjectID(result.value.alias);

        db.users.collection('domainaliases').findOne(
            {
                _id: alias
            },
            (err, aliasData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }
                if (!aliasData) {
                    res.status(404);
                    res.json({
                        error: 'Invalid or unknown alias'
                    });
                    return next();
                }

                res.json({
                    success: true,
                    id: aliasData._id,
                    alias: aliasData.alias,
                    domain: aliasData.domain,
                    created: aliasData.created
                });

                return next();
            }
        );
    });

    /**
     * @api {delete} /domainaliases/:alias Delete an Alias
     * @apiName DeleteDomainAlias
     * @apiGroup Domain Aliases
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} alias ID of the Alias
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/domainaliases/59ef21aef255ed1d9d790e81
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
     *       "error": "Database error"
     *     }
     */
    server.del('/domainaliases/:alias', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            alias: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required()
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

        let alias = new ObjectID(result.value.alias);

        db.users.collection('domainaliases').findOne(
            {
                _id: alias
            },
            (err, aliasData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                if (!aliasData) {
                    res.status(404);
                    res.json({
                        error: 'Invalid or unknown email alias identifier'
                    });
                    return next();
                }

                // delete address from email address registry
                db.users.collection('domainaliases').deleteOne(
                    {
                        _id: alias
                    },
                    (err, r) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message
                            });
                            return next();
                        }

                        res.json({
                            success: !!r.deletedCount
                        });
                        return next();
                    }
                );
            }
        );
    });
};
