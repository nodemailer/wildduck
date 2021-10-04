'use strict';

const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const DkimHandler = require('../dkim-handler');
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema } = require('../schemas');

module.exports = (db, server) => {
    const dkimHandler = new DkimHandler({
        cipher: config.dkim.cipher,
        secret: config.dkim.secret,
        database: db.database,
        redis: db.redis
    });

    server.get(
        { name: 'dkim', path: '/dkim' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                query: Joi.string().empty('').trim().max(255),
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
            req.validate(roles.can(req.role).readAny('dkim'));

            let query = result.value.query;
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter = query
                ? {
                      domain: {
                          $regex: tools.escapeRegexStr(query),
                          $options: ''
                      }
                  }
                : {};

            let total = await db.database.collection('dkim').countDocuments(filter);

            let opts = {
                limit,
                query: filter,
                paginatedField: 'domain',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.database.collection('dkim'), opts);
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
                results: (listing.results || []).map(dkimData => ({
                    id: dkimData._id.toString(),
                    domain: dkimData.domain,
                    selector: dkimData.selector,
                    description: dkimData.description,
                    fingerprint: dkimData.fingerprint,
                    created: dkimData.created
                }))
            };

            res.json(response);
            return next();
        })
    );

    server.get(
        '/dkim/resolve/:domain',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
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
            req.validate(roles.can(req.role).readAny('dkim'));

            let domain = tools.normalizeDomain(result.value.domain);

            let dkimData;

            try {
                dkimData = await db.database.collection('dkim').findOne(
                    {
                        domain
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

            if (!dkimData) {
                res.status(404);
                res.json({
                    error: 'This domain does not exist',
                    code: 'DkimNotFound'
                });
                return next();
            }

            res.json({
                success: true,
                id: dkimData._id.toString()
            });

            return next();
        })
    );

    server.post(
        '/dkim',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                domain: Joi.string()
                    .max(255)
                    //.hostname()
                    .required(),
                selector: Joi.string()
                    .max(255)
                    //.hostname()
                    .trim()
                    .required(),
                privateKey: Joi.string()
                    .empty('')
                    .trim()
                    .regex(/^-----BEGIN (RSA )?PRIVATE KEY-----/, 'DKIM key format'),
                description: Joi.string()
                    .max(255)
                    //.hostname()
                    .trim(),
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
            req.validate(roles.can(req.role).createAny('dkim'));

            let response;

            try {
                response = await dkimHandler.set(result.value);
            } catch (err) {
                res.status(err.responseCode || 500);
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (response) {
                response.success = true;
            }

            res.json(response);
            return next();
        })
    );

    server.get(
        '/dkim/:dkim',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                dkim: Joi.string().hex().lowercase().length(24).required(),
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
            req.validate(roles.can(req.role).readAny('dkim'));

            let dkim = new ObjectId(result.value.dkim);

            let response;
            try {
                response = await dkimHandler.get({ _id: dkim }, false);
            } catch (err) {
                res.status(err.responseCode || 500);
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (response) {
                response.success = true;
            }

            res.json(response);
            return next();
        })
    );

    server.del(
        '/dkim/:dkim',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                dkim: Joi.string().hex().lowercase().length(24).required(),
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
            req.validate(roles.can(req.role).deleteAny('dkim'));

            let dkim = new ObjectId(result.value.dkim);

            let response;

            try {
                response = await dkimHandler.del({ _id: dkim });
            } catch (err) {
                res.status(err.responseCode || 500);
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success: response
            });

            return next();
        })
    );
};
