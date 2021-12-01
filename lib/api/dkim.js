'use strict';

const config = require('wild-config');
const Boom = require('@hapi/boom');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const DkimHandler = require('../dkim-handler');
const { failAction, escapeRegexStr, normalizeDomain } = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema } = require('../schemas');

const privateKeySchema = Joi.string()
    .empty('')
    .trim()
    .regex(/^-+BEGIN (RSA )?PRIVATE KEY-+\s/, 'Certificate key format');

module.exports = (server, db) => {
    const dkimHandler = new DkimHandler({
        cipher: config.dkim.cipher,
        secret: config.dkim.secret,
        database: db.database,
        redis: db.redis
    });

    server.route({
        method: 'GET',
        path: '/dkim',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('dkim');
            request.validateAcl(permission);

            let query = request.query.query;
            let limit = request.query.limit;
            let page = request.query.page;
            let pageNext = request.query.next;
            let pagePrevious = request.query.previous;

            let filter = query
                ? {
                      domain: {
                          $regex: escapeRegexStr(query),
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
                results: (listing.results || []).map(dkimData => ({
                    id: dkimData._id.toString(),
                    domain: dkimData.domain,
                    selector: dkimData.selector,
                    description: dkimData.description,
                    fingerprint: dkimData.fingerprint,
                    created: dkimData.created
                }))
            };

            return permission.filter(response);
        },

        options: {
            description: 'List DKIM certificates',
            notes: 'List stored DKIM certificates',
            tags: ['api', 'DKIM'],

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
                    limit: Joi.number().default(20).min(1).max(250).example(20),
                    next: nextPageCursorSchema,
                    previous: previousPageCursorSchema,
                    page: pageNrSchema,
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('ListDkimQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().example('example.com').description('Partial hostname match'),
                    total: Joi.number().required().example(123).description('How many DKIM certificates wer found'),
                    page: Joi.number().required().example(1).description('Current response page'),
                    previousCursor: previousPageCursorSchema.allow(false),
                    nextCursor: nextPageCursorSchema.allow(false),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: Joi.string().hex().length(24).required().example('613b069b9a6cbad5ba18d552'),
                                domain: Joi.string().hostname().example('example.com').description('DKIM Domain').required(),
                                selector: Joi.string().example('wildduck').required().description('DKIM Selector'),
                                description: Joi.string().example('Some description about this certificate'),
                                fingerprint: Joi.string().example('ab:12:ef:12...'),
                                created: Joi.string().isoDate().example('2021-11-23T12:11:37.642Z')
                            }).label('DkimListItem')
                        )
                        .description('Result listing')
                        .label('DkimListItems')
                }).label('ListDkimQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/dkim/resolve/{domain}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('dkim');
            request.validateAcl(permission);

            let domain = normalizeDomain(request.params.domain);

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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!dkimData) {
                let error = Boom.boomify(new Error('This domain does not exist'), { statusCode: 404 });
                error.output.payload.code = 'DkimNotFound';
                throw error;
            }

            return permission.filter({
                success: true,
                id: dkimData._id.toString()
            });
        },

        options: {
            description: 'Resolve certificate for a domain',
            notes: 'Searches for a DKIM certificate based on the domain. Exact matches only.',
            tags: ['api', 'DKIM'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    domain: Joi.string().hostname().required().example('example.com').description('Domain name to resolve a certificate for')
                }).label('ResolveDkimParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('ResolveDkimQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('ResolveDkimReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/dkim',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).createAny('dkim');
            request.validateAcl(permission);

            let response;

            try {
                response = await dkimHandler.set(request.payload);
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: err.responseCode || 500 });
                error.output.payload.code = err.code;
                throw error;
            }

            if (response) {
                response.success = true;
            }

            return permission.filter(
                Object.assign(
                    {
                        success: !!response
                    },
                    response || {}
                )
            );
        },

        options: {
            description: 'Create a new DKIM entry',
            notes: 'Creates a new DKIM entry',
            tags: ['api', 'DKIM'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                payload: Joi.object({
                    domain: Joi.string().empty('').hostname().required().label('DomainName').example('example.com'),
                    selector: Joi.string().example('wildduck').required().description('DKIM Selector'),

                    privateKey: privateKeySchema
                        .required()
                        .label('PrivateKey')
                        .description('PEM formatted TLS private key')
                        .example('-----BEGIN PRIVATE KEY-----\nMIIEvQIBADA...'),

                    description: Joi.string().empty('').max(1024).trim().label('Description').example('Some text about this DKIM certificate'),

                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('CreateDkimCertQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552'),
                    domain: Joi.string().hostname().example('example.com').description('DKIM Domain').required(),
                    selector: Joi.string().example('wildduck').required().description('DKIM Selector'),
                    description: Joi.string().example('Some description about this certificate'),
                    fingerprint: Joi.string().example('ab:12:ef:12...'),
                    publicKey: Joi.string().example('-----BEGIN PUBLIC KEY-----\r\nMIGfMA0GCSqGSIb...').description('Public key'),
                    dnsTxt: Joi.object({
                        name: Joi.string().example('wildduck._domainkey.example.com').description('DNS TXT name for the DKIM record'),
                        value: Joi.string().example('v=DKIM1;t=s;p=MIGfMA0GCSqGSIb3DQ...').description('DNS TXT contents')
                    })
                        .label('DNSText')
                        .description('Example contents for the DNS TXT record')
                }).label('DkimCertReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/dkim/{dkim}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('dkim');
            request.validateAcl(permission);

            let dkim = new ObjectId(request.params.dkim);

            let response;
            try {
                response = await dkimHandler.get({ _id: dkim }, false);
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: err.responseCode || 500 });
                error.output.payload.code = err.code;
                throw error;
            }

            return permission.filter(Object.assign({ success: !!response }, response || {}));
        },

        options: {
            description: 'Retrieve DKIM information',
            notes: 'Looks up a DKIM certificate based on the ID',
            tags: ['api', 'DKIM'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    dkim: Joi.string().hex().lowercase().length(24).required().example('613b069b9a6cbad5ba18d552').description('The dkim ID to look for')
                }).label('RetrieveDkimParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('RetrieveDkimQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552'),
                    domain: Joi.string().hostname().example('example.com').description('DKIM Domain').required(),
                    selector: Joi.string().example('wildduck').required().description('DKIM Selector'),
                    description: Joi.string().example('Some description about this DKIM certificate'),
                    fingerprint: Joi.string().example('ab:12:ef:12...'),
                    publicKey: Joi.string().example('-----BEGIN PUBLIC KEY-----\r\nMIGfMA0GCSqGSIb...').description('Public key'),
                    dnsTxt: Joi.object({
                        name: Joi.string().example('wildduck._domainkey.example.com').description('DNS TXT name for the DKIM record'),
                        value: Joi.string().example('v=DKIM1;t=s;p=MIGfMA0GCSqGSIb3DQ...').description('DNS TXT contents')
                    })
                        .label('DNSText')
                        .description('Example contents for the DNS TXT record'),
                    created: Joi.string().isoDate().example('2021-11-23T12:11:37.642Z')
                }).label('DkimCertReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/dkim/{dkim}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).deleteAny('dkim');
            request.validateAcl(permission);

            let dkim = new ObjectId(request.params.dkim);

            let response;

            try {
                response = await dkimHandler.del({ _id: dkim });
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: err.responseCode || 500 });
                error.output.payload.code = err.code;
                throw error;
            }

            return permission.filter({
                success: !!response,
                id: response ? dkim.toString() : undefined
            });
        },

        options: {
            description: 'Delete a DKIM certificate',
            notes: 'Deletes a DKIM certificate and stops signing messages with that selector',
            tags: ['api', 'DKIM'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    dkim: Joi.string().hex().lowercase().length(24).required().example('613b069b9a6cbad5ba18d552').description('The DKIM ID to look for')
                }).label('DeleteDKIMParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('DeleteDKIMQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('DKIMDeleteCertReponse'),
                failAction: 'log'
            }
        }
    });
};
