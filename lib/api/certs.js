'use strict';

const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const CertHandler = require('../cert-handler');
const TaskHandler = require('../task-handler');
const tools = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema } = require('../schemas');

const certificateSchema = Joi.string()
    .empty('')
    .trim()
    .regex(/^-+BEGIN CERTIFICATE-+\s/, 'Certificate format');

const privateKeySchema = Joi.string()
    .empty('')
    .trim()
    .regex(/^-+BEGIN (RSA )?PRIVATE KEY-+\s/, 'Certificate key format');

module.exports = (db, server) => {
    const certHandler = new CertHandler({
        cipher: config.certs && config.certs.cipher,
        secret: config.certs && config.certs.secret,
        database: db.database,
        redis: db.redis
    });

    const taskHandler = new TaskHandler({
        database: db.database
    });

    server.get(
        { name: 'cert', path: '/certs' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                query: Joi.string().empty('').trim().max(255),
                altNames: booleanSchema.default(false),
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
            req.validate(roles.can(req.role).readAny('certs'));

            let query = result.value.query;
            let altNames = result.value.altNames;
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter = query
                ? {
                      servername: {
                          $regex: tools.escapeRegexStr(query),
                          $options: ''
                      }
                  }
                : {};

            if (query && altNames) {
                filter = {
                    $or: [
                        filter,
                        {
                            altNames: {
                                $regex: tools.escapeRegexStr(query),
                                $options: ''
                            }
                        }
                    ]
                };

                if (query.indexOf('.') >= 0) {
                    let wcMatch = '*' + query.substr(query.indexOf('.'));
                    filter.$or.push({ altNames: wcMatch });
                }
            }

            let total = await db.database.collection('certs').countDocuments(filter);

            let opts = {
                limit,
                query: filter,
                paginatedField: 'servername',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.database.collection('certs'), opts);
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
                results: (listing.results || []).map(certData => ({
                    id: certData._id.toString(),
                    servername: certData.servername,
                    description: certData.description,
                    fingerprint: certData.fingerprint,
                    expires: certData.expires,
                    altNames: certData.altNames,
                    acme: !!certData.acme,
                    created: certData.created
                }))
            };

            res.json(response);
            return next();
        })
    );

    server.get(
        '/certs/resolve/:servername',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                servername: Joi.string().hostname(),
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
            req.validate(roles.can(req.role).readAny('certs'));

            let servername = tools.normalizeDomain(result.value.servername);

            let certData;

            try {
                certData = await db.database.collection('certs').findOne(
                    {
                        servername
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

            if (!certData) {
                res.status(404);
                res.json({
                    error: 'This servername does not exist',
                    code: 'CertNotFound'
                });
                return next();
            }

            res.json({
                success: true,
                id: certData._id.toString()
            });

            return next();
        })
    );

    server.post(
        '/certs',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                servername: Joi.string().empty('').hostname().required().label('ServerName'),

                privateKey: Joi.string()
                    .when('acme', {
                        switch: [
                            {
                                is: false,
                                then: privateKeySchema.required()
                            },
                            {
                                is: true,
                                then: privateKeySchema.required().optional()
                            }
                        ]
                    })

                    .label('PrivateKey'),

                cert: Joi.string()
                    .when('acme', {
                        switch: [
                            {
                                is: false,
                                then: certificateSchema.required()
                            },
                            {
                                is: true,
                                then: certificateSchema.optional()
                            }
                        ]
                    })
                    .label('Certificate'),

                ca: Joi.array().items(certificateSchema.label('CACert')).label('CACertList'),

                description: Joi.string().empty('').max(1024).trim().label('Description'),
                acme: booleanSchema.default(false).label('ACMEManaged'),

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
            req.validate(roles.can(req.role).createAny('certs'));

            let response;

            try {
                response = await certHandler.set(result.value);
            } catch (err) {
                switch (err.code) {
                    case 'InputValidationError':
                        res.status(400);
                        break;
                    case 'CertNotFound':
                        res.status(404);
                        break;
                    default:
                        res.status(500);
                }

                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (response) {
                response.success = true;
            }

            if (result.value.acme) {
                await taskHandler.ensure('acme', { servername: result.value.servername }, { servername: result.value.servername });
            }

            res.json(response);
            return next();
        })
    );

    server.get(
        '/certs/:cert',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                cert: Joi.string().hex().lowercase().length(24).required(),
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
            req.validate(roles.can(req.role).readAny('certs'));

            let cert = new ObjectId(result.value.certs);

            let response;
            try {
                response = await certHandler.get({ _id: cert }, false);
            } catch (err) {
                switch (err.code) {
                    case 'InputValidationError':
                        res.status(400);
                        break;
                    case 'CertNotFound':
                        res.status(404);
                        break;
                    default:
                        res.status(500);
                }
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
        '/certs/:certs',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                certs: Joi.string().hex().lowercase().length(24).required(),
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
            req.validate(roles.can(req.role).deleteAny('certs'));

            let certs = new ObjectId(result.value.certs);

            let response;

            try {
                response = await certHandler.del({ _id: certs });
            } catch (err) {
                switch (err.code) {
                    case 'InputValidationError':
                        res.status(400);
                        break;
                    case 'CertNotFound':
                        res.status(404);
                        break;
                    default:
                        res.status(500);
                }
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
