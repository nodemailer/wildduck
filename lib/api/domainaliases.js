'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema } = require('../schemas');
const { publish, DOMAINALIAS_CREATED, DOMAINALIAS_DELETED } = require('../events');

module.exports = (db, server) => {
    server.get(
        { name: 'domainaliases', path: '/domainaliases' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                query: Joi.string().trim().empty('').max(255),
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

            // permissions check
            req.validate(roles.can(req.role).readAny('domainaliases'));

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
                                  $regex: tools.escapeRegexStr(query),
                                  $options: ''
                              }
                          },

                          {
                              domain: {
                                  $regex: tools.escapeRegexStr(query),
                                  $options: ''
                              }
                          }
                      ]
                  }
                : {};

            let total = await db.users.collection('domainaliases').countDocuments(filter);

            let opts = {
                limit,
                query: filter,
                fields: {
                    // FIXME: hack to keep alias in response
                    alias: true,
                    // FIXME: MongoPaging inserts fields value as second argument to col.find()
                    projection: {
                        _id: true,
                        alias: true,
                        domain: true
                    }
                },
                paginatedField: 'alias',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.users.collection('domainaliases'), opts);
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
                query,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(domainData => ({
                    id: domainData._id.toString(),
                    alias: domainData.alias,
                    domain: domainData.domain
                }))
            };

            res.json(response);
            return next();
        })
    );

    server.post(
        '/domainaliases',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                alias: Joi.string()
                    .max(255)
                    //.hostname()
                    .required(),
                domain: Joi.string()
                    .max(255)
                    //.hostname()
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
            req.validate(roles.can(req.role).createAny('domainaliases'));

            let alias = tools.normalizeDomain(req.params.alias);
            let domain = tools.normalizeDomain(req.params.domain);

            let aliasData;

            try {
                aliasData = await db.users.collection('domainaliases').findOne(
                    {
                        alias
                    },
                    {
                        projection: { _id: 1 }
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

            if (aliasData) {
                res.status(400);
                res.json({
                    error: 'This domain alias already exists',
                    code: 'AliasExists'
                });
                return next();
            }

            let r;

            try {
                // insert alias address to email address registry
                r = await db.users.collection('domainaliases').insertOne({
                    alias,
                    domain,
                    created: new Date()
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            let insertId = r.insertedId;

            await publish(db.redis, {
                ev: DOMAINALIAS_CREATED,
                domainalias: insertId,
                alias,
                domain
            });

            res.json({
                success: !!insertId,
                id: insertId
            });
            return next();
        })
    );

    server.get(
        '/domainaliases/resolve/:alias',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                alias: Joi.string()
                    .max(255)
                    //.hostname()
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
            req.validate(roles.can(req.role).readAny('domainaliases'));

            let alias = tools.normalizeDomain(result.value.alias);

            let aliasData;
            try {
                aliasData = await db.users.collection('domainaliases').findOne(
                    {
                        alias
                    },
                    {
                        projection: { _id: 1 }
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

            if (!aliasData) {
                res.status(404);
                res.json({
                    error: 'This alias does not exist',
                    code: 'AliasNotFound'
                });
                return next();
            }
            res.json({
                success: true,
                id: aliasData._id.toString()
            });

            return next();
        })
    );

    server.get(
        '/domainaliases/:alias',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                alias: Joi.string().hex().lowercase().length(24).required(),
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
            req.validate(roles.can(req.role).readAny('domainaliases'));

            let alias = new ObjectId(result.value.alias);

            let aliasData;
            try {
                aliasData = await db.users.collection('domainaliases').findOne({
                    _id: alias
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!aliasData) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown alias',
                    code: 'AliasNotFound'
                });
                return next();
            }

            res.json({
                success: true,
                id: aliasData._id.toString(),
                alias: aliasData.alias,
                domain: aliasData.domain,
                created: aliasData.created
            });

            return next();
        })
    );

    server.del(
        '/domainaliases/:alias',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                alias: Joi.string().hex().lowercase().length(24).required(),
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
            req.validate(roles.can(req.role).deleteAny('domainaliases'));

            let alias = new ObjectId(result.value.alias);

            let aliasData;
            try {
                aliasData = await db.users.collection('domainaliases').findOne(
                    {
                        _id: alias
                    },
                    {
                        projection: { _id: 1 }
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

            if (!aliasData) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown email alias identifier',
                    code: 'AliasNotFound'
                });
                return next();
            }

            let r;
            try {
                // delete address from email address registry
                r = await db.users.collection('domainaliases').deleteOne({
                    _id: alias
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (r.deletedCount) {
                await publish(db.redis, {
                    ev: DOMAINALIAS_DELETED,
                    domainalias: alias,
                    alias: aliasData.alias,
                    domain: aliasData.domain
                });
            }

            res.json({
                success: !!r.deletedCount
            });
            return next();
        })
    );
};
