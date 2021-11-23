'use strict';

const Boom = require('@hapi/boom');
const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const CertHandler = require('../cert-handler');
const TaskHandler = require('../task-handler');
const tools = require('../tools');

const { failAction, escapeRegexStr } = require('../tools');

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

module.exports = (server, db) => {
    const certHandler = new CertHandler({
        cipher: config.certs && config.certs.cipher,
        secret: config.certs && config.certs.secret,
        database: db.database,
        redis: db.redis
    });

    const taskHandler = new TaskHandler({
        database: db.database
    });

    server.route({
        method: 'GET',
        path: '/certs',

        async handler(request) {
            // permissions check

            let permission = roles.can(request.app.role).readAny('certs');
            request.validateAcl(permission);

            let query = request.query;
            let altNames = request.altNames;
            let limit = request.limit;
            let page = request.page;
            let pageNext = request.next;
            let pagePrevious = request.previous;

            let filter = query
                ? {
                      servername: {
                          $regex: escapeRegexStr(query),
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
                                $regex: escapeRegexStr(query),
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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
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

            return permission.filter(response);
        },

        options: {
            description: 'List TLS certificates',
            notes: 'List stored TLS certificates',
            tags: ['api', 'Certs'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                query: Joi.object({
                    query: Joi.string().example('example.com').description('Partial hostname match'),
                    altNames: booleanSchema.example(false).default(false).description('Should alternative names be checked as well'),
                    limit: Joi.number().default(20).min(1).max(250).example(20),
                    next: nextPageCursorSchema,
                    previous: previousPageCursorSchema,
                    page: pageNrSchema,
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('ListTlsQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().example('example.com').description('Partial hostname match'),
                    total: Joi.number().required().example(123).description('How many certificates wer found'),
                    page: Joi.number().required().example(1).description('Current response page'),
                    previousCursor: previousPageCursorSchema.allow(false),
                    nextCursor: nextPageCursorSchema.allow(false),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: Joi.string().hex().length(24).required().example('613b069b9a6cbad5ba18d552'),
                                servername: Joi.string().hostname().example('example.com').required(),
                                description: Joi.string().example('Some description about this certificate'),
                                fingerprint: Joi.string().example('ab:12:ef:12...'),
                                expires: Joi.string().isoDate().example('2021-11-23T12:11:37.642Z'),
                                altNames: Joi.array()
                                    .items(Joi.string().hostname().example('*.example.com'))
                                    .example(['example.com', '*.example.com'])
                                    .description('All domain names this certificate is valid for'),
                                acme: Joi.boolean().example(true).description('Is this certificate managed by ACME'),
                                created: Joi.string().isoDate().example('2021-11-23T12:11:37.642Z')
                            }).label('CertiListItem')
                        )
                        .description('Result listing')
                        .label('CertiListItems')
                }).label('ListTlsQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/certs/resolve/{servername}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('certs');
            request.validateAcl(permission);

            let servername = tools.normalizeDomain(request.query.servername);

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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!certData) {
                let error = Boom.boomify(new Error('This servername does not exist'), { statusCode: 404 });
                error.output.payload.code = 'CertNotFound';
                throw error;
            }

            return permission.filter({
                success: true,
                id: certData._id.toString()
            });
        },

        options: {
            description: 'Resolve certificate for a hostname',
            notes: 'Searches for a TLS certificate based on the hostname. Must be an exact or wildcard match against the alternative names list',
            tags: ['api', 'Certs'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    servername: Joi.string().hostname().required().example('example.com').description('Hostname to resolve a certificate for')
                }).label('ResolveTlsParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('ResolveTlsQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('ResolveTlsReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/certs',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).createAny('certs');
            request.validateAcl(permission);

            let response;

            try {
                response = await certHandler.set(request.payload);
            } catch (err) {
                let statusCode;
                switch (err.code) {
                    case 'InputValidationError':
                        statusCode = 400;
                        break;
                    case 'CertNotFound':
                        statusCode = 404;
                        break;
                    default:
                        statusCode = 500;
                }

                let error = Boom.boomify(new Error(err.message), { statusCode });
                if (err.code) {
                    error.output.payload.code = err.code;
                }
                throw error;
            }

            if (response) {
                response.success = true;
            }

            if (request.payload.acme) {
                await taskHandler.ensure('acme', { servername: request.payload.servername }, { servername: request.payload.servername });
            }

            return permission.filter(Object.assign({ success: !!response }, response || {}));
        },

        options: {
            description: 'Create a new certificate entry',
            notes: 'Creates a new certificate entry, either a complete record with keys or an ACME managed entry',
            tags: ['api', 'Certs'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                payload: Joi.object({
                    servername: Joi.string().empty('').hostname().required().label('ServerName').example('example.com'),

                    privateKey: Joi.string()
                        .when('acme', {
                            switch: [
                                {
                                    is: false,
                                    then: privateKeySchema.required()
                                },
                                {
                                    is: true,
                                    then: privateKeySchema.optional()
                                }
                            ]
                        })

                        .label('PrivateKey')
                        .description('PEM formatted TLS private key. Optional if certificate is managed by ACME')
                        .example('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADA...'),

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
                        .label('Certificate')
                        .description(
                            'PEM formatted TLS certificate or a certificate bundle with concatenated certificate and CA chain. Optional if certificate is managed by ACME'
                        )
                        .example('-----BEGIN CERTIFICATE-----\nMIIDEDCCAfgs...'),

                    ca: Joi.array()
                        .items(certificateSchema.label('CACert').example('----BEGIN CERTIFICATE-----\nMIIDEDCCAfgs...'))
                        .description('CA chain certificates. Not needed if `cert` value is a bundle')
                        .label('CACertList'),

                    description: Joi.string().empty('').max(1024).trim().label('Description').example('Some text about this cert'),
                    acme: booleanSchema.default(false).example(true).label('ACMEManaged').description('Is the certificate managed by ACME'),

                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('CreateTlsQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552'),
                    servername: Joi.string().hostname().example('example.com').required(),
                    description: Joi.string().example('Some description about this certificate'),
                    fingerprint: Joi.string().example('ab:12:ef:12...'),
                    expires: Joi.string().isoDate().example('2021-11-23T12:11:37.642Z'),
                    altNames: Joi.array()
                        .items(Joi.string().hostname().example('*.example.com'))
                        .example(['example.com', '*.example.com'])
                        .description('All domain names this certificate is valid for'),
                    acme: Joi.boolean().example(true).description('Is this certificate managed by ACME')
                }).label('TlsCertReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/certs/{cert}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('certs');
            request.validateAcl(permission);

            let cert = new ObjectId(request.params.cert);

            let response;
            try {
                response = await certHandler.get({ _id: cert }, false);
            } catch (err) {
                let statusCode;
                switch (err.code) {
                    case 'InputValidationError':
                        statusCode = 400;
                        break;
                    case 'CertNotFound':
                        statusCode = 404;
                        break;
                    default:
                        statusCode = 500;
                }

                let error = Boom.boomify(new Error(err.message), { statusCode });
                if (err.code) {
                    error.output.payload.code = err.code;
                }
                throw error;
            }

            return permission.filter(Object.assign({ success: !!response }, response || {}));
        },

        options: {
            description: 'Retrieve certificate information',
            notes: 'Looks up a certificate based on the ID',
            tags: ['api', 'Certs'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    cert: Joi.string().hex().lowercase().length(24).required().example('613b069b9a6cbad5ba18d552').description('The certificate ID to look for')
                }).label('RetrieveTlsParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('RetrieveTlsQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552'),
                    servername: Joi.string().hostname().example('example.com').required(),
                    description: Joi.string().example('Some description about this certificate'),
                    fingerprint: Joi.string().example('ab:12:ef:12...'),
                    expires: Joi.string().isoDate().example('2021-11-23T12:11:37.642Z'),
                    altNames: Joi.array()
                        .items(Joi.string().hostname().example('*.example.com'))
                        .example(['example.com', '*.example.com'])
                        .description('All domain names this certificate is valid for'),
                    acme: Joi.boolean().example(true).description('Is this certificate managed by ACME')
                }).label('TlsCertReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/certs/{cert}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).deleteAny('certs');
            request.validateAcl(permission);

            let cert = new ObjectId(request.params.cert);

            let response;

            try {
                response = await certHandler.del({ _id: cert });
            } catch (err) {
                let statusCode;
                switch (err.code) {
                    case 'InputValidationError':
                        statusCode = 400;
                        break;
                    case 'CertNotFound':
                        statusCode = 404;
                        break;
                    default:
                        statusCode = 500;
                }

                let error = Boom.boomify(new Error(err.message), { statusCode });
                if (err.code) {
                    error.output.payload.code = err.code;
                }
                throw error;
            }

            return {
                success: !!response,
                id: request.params.cert
            };
        },

        options: {
            description: 'Delete a certificate',
            notes: 'Deletes a certificate and stops managing it with ACME',
            tags: ['api', 'Certs'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    cert: Joi.string().hex().lowercase().length(24).required().example('613b069b9a6cbad5ba18d552').description('The certificate ID to look for')
                }).label('DeleteTlsParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('DeleteTlsQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('TlsDeleteCertReponse'),
                failAction: 'log'
            }
        }
    });
};
