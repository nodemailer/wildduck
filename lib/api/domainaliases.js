'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const Boom = require('@hapi/boom');
const { ObjectId } = require('mongodb');
const { escapeRegexStr, failAction, normalizeDomain } = require('../tools');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema } = require('../schemas');
const { publish, DOMAINALIAS_CREATED, DOMAINALIAS_DELETED } = require('../events');

module.exports = (server, db) => {
    server.route({
        method: 'GET',
        path: '/domainaliases',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('domainaliases');
            request.validateAcl(permission);

            let query = request.query.query;
            let limit = request.query.limit;
            let page = request.query.page;
            let pageNext = request.query.next;
            let pagePrevious = request.query.previous;

            let filter = query
                ? {
                      $or: [
                          {
                              alias: {
                                  $regex: escapeRegexStr(query),
                                  $options: ''
                              }
                          },

                          {
                              domain: {
                                  $regex: escapeRegexStr(query),
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
                results: (listing.results || []).map(domainData =>
                    permission.filter({
                        id: domainData._id.toString(),
                        alias: domainData.alias,
                        domain: domainData.domain
                    })
                )
            };

            return response;
        },

        options: {
            description: 'List domain aliases',
            notes: 'List stored domain name aliases',
            tags: ['api', 'DomainAliases'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                query: Joi.object({
                    query: Joi.string().example('example.com').description('Partial domain name match'),
                    limit: Joi.number().default(20).min(1).max(250).example(20),
                    next: nextPageCursorSchema,
                    previous: previousPageCursorSchema,
                    page: pageNrSchema
                }).label('ListDomainAliasQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().example('example.com').description('Partial hostname match'),
                    total: Joi.number().required().example(123).description('How many aliases were found'),
                    page: Joi.number().required().example(1).description('Current response page'),
                    previousCursor: previousPageCursorSchema.allow(false),
                    nextCursor: nextPageCursorSchema.allow(false),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: Joi.string().hex().length(24).required().example('613b069b9a6cbad5ba18d552'),
                                domain: Joi.string().hostname().example('example.com').description('This is the target domain for the alias').required(),
                                alias: Joi.string()
                                    .hostname()
                                    .example('www.example.com')
                                    .description('This is the alias domain that is resolved into the target domain')
                                    .required()
                            }).label('DomainAliasListItem')
                        )
                        .description('Result listing')
                        .label('DomainAliasListItems')
                }).label('ListDomainAliasQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/domainaliases',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).createAny('domainaliases');
            request.validateAcl(permission);

            let alias = normalizeDomain(request.payload.alias);
            let domain = normalizeDomain(request.payload.domain);

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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (aliasData) {
                let error = Boom.boomify(new Error('This domain alias already exists'), { statusCode: 400 });
                error.output.payload.code = 'AliasExists';
                throw error;
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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            let insertId = r.insertedId;

            await publish(db.redis, {
                ev: DOMAINALIAS_CREATED,
                domainalias: insertId,
                alias,
                domain
            });

            return {
                success: !!insertId,
                id: insertId ? insertId.toString() : undefined
            };
        },

        options: {
            description: 'Register a new Domain Alias',
            notes: 'Creates a new Domain Alias entry',
            tags: ['api', 'DomainAliases'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                payload: Joi.object({
                    domain: Joi.string().hostname().example('example.com').description('This is the target domain for the alias').required(),
                    alias: Joi.string()
                        .hostname()
                        .example('www.example.com')
                        .description('This is the alias domain that is resolved into the target domain')
                        .required()
                }).label('CreateDomainAliasQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('DomainAliasReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/domainaliases/resolve/{alias}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('domainaliases');
            request.validateAcl(permission);

            let alias = normalizeDomain(request.params.alias);

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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!aliasData) {
                let error = Boom.boomify(new Error('This alias does not exist'), { statusCode: 404 });
                error.output.payload.code = 'AliasNotFound';
                throw error;
            }

            return {
                success: true,
                id: aliasData._id.toString()
            };
        },

        options: {
            description: 'Resolve an alias domain',
            notes: 'Searches for a domain alias.',
            tags: ['api', 'DomainAliases'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    alias: Joi.string()
                        .hostname()
                        .required()
                        .example('example.com')
                        .description('This is the alias domain that is resolved into the target domain')
                }).label('ResolveDomainAliasParams')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('ResolveDomainAliasReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/domainaliases/{domainalias}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('domainaliases');
            request.validateAcl(permission);

            let domainalias = new ObjectId(request.params.domainalias);

            let aliasData;
            try {
                aliasData = await db.users.collection('domainaliases').findOne({
                    _id: domainalias
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!aliasData) {
                let error = Boom.boomify(new Error('Invalid or unknown alias'), { statusCode: 404 });
                error.output.payload.code = 'AliasNotFound';
                throw error;
            }

            return {
                success: true,
                id: aliasData._id.toString(),
                alias: aliasData.alias,
                domain: aliasData.domain,
                created: aliasData.created
            };
        },

        options: {
            description: 'Retrieve Domain Alias information',
            notes: 'Looks up a Domain Alias based on the ID',
            tags: ['api', 'DomainAliases'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    domainalias: Joi.string()
                        .hex()
                        .lowercase()
                        .length(24)
                        .required()
                        .example('613b069b9a6cbad5ba18d552')
                        .description('The domain alias ID to look for')
                }).label('RetrieveDomainAliasParams')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552'),
                    domain: Joi.string().hostname().example('example.com').description('This is the target domain for the alias').required(),
                    alias: Joi.string()
                        .hostname()
                        .example('www.example.com')
                        .description('This is the alias domain that is resolved into the target domain')
                        .required(),
                    created: Joi.string().isoDate().example('2021-11-23T12:11:37.642Z')
                }).label('DomainAliasReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/domainaliases/{domainalias}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).deleteAny('domainaliases');
            request.validateAcl(permission);

            let domainalias = new ObjectId(request.params.domainalias);

            let aliasData;
            try {
                aliasData = await db.users.collection('domainaliases').findOne(
                    {
                        _id: domainalias
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

            if (!aliasData) {
                let error = Boom.boomify(new Error('Invalid or unknown email alias identifier'), { statusCode: 404 });
                error.output.payload.code = 'AliasNotFound';
                throw error;
            }

            let r;
            try {
                // delete address from email address registry
                r = await db.users.collection('domainaliases').deleteOne({
                    _id: domainalias
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (r.deletedCount) {
                await publish(db.redis, {
                    ev: DOMAINALIAS_DELETED,
                    domainalias,
                    alias: aliasData.alias,
                    domain: aliasData.domain
                });
            }

            return {
                success: !!r.deletedCount,
                id: r.deletedCount ? domainalias.toString() : undefined
            };
        },

        options: {
            description: 'Delete a Domain Alias',
            notes: 'Deletes a Domain Alias',
            tags: ['api', 'DomainAliases'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    domainalias: Joi.string()
                        .hex()
                        .lowercase()
                        .length(24)
                        .required()
                        .example('613b069b9a6cbad5ba18d552')
                        .description('The domain alias ID to look for')
                }).label('DeleteDomainAliasParams')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('DeleteDomainAliasReponse'),
                failAction: 'log'
            }
        }
    });
};
