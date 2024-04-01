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
const { successRes, totalRes, pageRes, previousCursorRes, nextCursorRes } = require('../schemas/response/general-schemas');

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
        {
            name: 'cert',
            path: '/certs',
            summary: 'List registered TLS certificates',
            tags: ['Certs'],
            validationObjs: {
                requestBody: {},
                queryParams: {
                    query: Joi.string().empty('').trim().max(255).example('example.com').description('Partial match of a server name'),
                    altNames: booleanSchema.default(false).description('Match `query` value against SAN as well (including wildcard names)').example('true'),
                    limit: Joi.number().default(20).min(1).max(250).description('How many records to return'),
                    next: nextPageCursorSchema,
                    previous: previousPageCursorSchema,
                    page: pageNrSchema,
                    sess: sessSchema,
                    ip: sessIPSchema
                },
                pathParams: {},
                response: {
                    200: {
                        description: 'Success',
                        model: Joi.object({
                            success: successRes,
                            total: totalRes,
                            page: pageRes,
                            previousCursor: previousCursorRes,
                            nextCursor: nextCursorRes,
                            results: Joi.array()
                                .items(
                                    Joi.object({
                                        id: Joi.string().required().description('ID of the certificate').example('609d201236d1d936948f23b1'),
                                        servername: Joi.string()
                                            .required()
                                            .description('The server name this certificate applies to')
                                            .example('imap.example.com'),
                                        acme: booleanSchema
                                            .required()
                                            .description('If true then private key and certificate are managed automatically by ACME'),
                                        description: Joi.string().required().description('Key description').example('Some notes about this certificate'),
                                        fingerprint: Joi.string()
                                            .required()
                                            .description('Key fingerprint (SHA1)')
                                            .example('59:8b:ed:11:5b:4f:ce:b4:e5:1a:2f:35:b1:6f:7d:93:40:c8:2f:9c:38:3b:cd:f4:04:92:a1:0e:17:2c:3f:f3'),
                                        created: Joi.date().required().description('Datestring').example('2024-03-13T20:06:46.179Z'),
                                        expires: Joi.date().required().description('Certificate expiration time').example('2024-04-26T21:55:55.000Z'),
                                        altNames: Joi.array()
                                            .items(Joi.string().required())
                                            .required()
                                            .description('SAN servernames listed in the certificate')
                                            .example(['example.com', 'www.example.com'])
                                    })
                                        .required()
                                        .description('Certificate listing')
                                        .$_setFlag('objectName', 'GetTLSCertResult')
                                )
                                .required()
                        })
                    }
                }
            }
        },
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const { requestBody, queryParams, pathParams } = req.route.spec.validationObjs;

            const schema = Joi.object({
                ...requestBody,
                ...queryParams,
                ...pathParams
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
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

            return res.json(response);
        })
    );

    server.get(
        '/certs/resolve/:servername',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            if (!certData) {
                res.status(404);
                return res.json({
                    error: 'This servername does not exist',
                    code: 'CertNotFound'
                });
            }

            return res.json({
                success: true,
                id: certData._id.toString()
            });
        })
    );

    server.post(
        '/certs',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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

                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            if (response) {
                response.success = true;
            }

            if (result.value.acme) {
                await taskHandler.ensure('acme', { servername: result.value.servername }, { servername: result.value.servername });
            }

            return res.json(response);
        })
    );

    server.get(
        '/certs/:cert',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
            }

            // permissions check
            req.validate(roles.can(req.role).readAny('certs'));

            let cert = new ObjectId(result.value.cert);

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

                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            if (response) {
                response.success = true;
            }

            return res.json(response);
        })
    );

    server.del(
        '/certs/:certs',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            return res.json({
                success: response
            });
        })
    );
};
