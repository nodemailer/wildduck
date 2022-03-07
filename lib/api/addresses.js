'use strict';

//const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const { ObjectId } = require('mongodb');
const { decodeWords } = require('libmime');
const Boom = require('@hapi/boom');
const roles = require('../roles');
//const libmime = require('libmime');

const { escapeRegexStr, formatMetaData, failAction, normalizeAddress, inputValidationError, uview, checkWildcardAddress } = require('../tools');

const {
    nextPageCursorSchema,
    previousPageCursorSchema,
    pageNrSchema,
    booleanSchema,
    tagsSchema,
    pageLimitSchema,
    userIdSchema,
    userNameSchema,
    forwardTargetSchema,
    metaDataSchema,
    mongoIdSchema,
    tagsArraySchema,
    autoreplySchema
} = require('../schemas');

const {
    publish,
    ADDRESS_USER_CREATED,
    ADDRESS_USER_DELETED,
    ADDRESS_FORWARDED_CREATED
    /*
    ADDRESS_FORWARDED_DELETED,
    ADDRESS_DOMAIN_RENAMED

*/
} = require('../events');

module.exports = (server, db /*, userHandler, settingsHandler */) => {
    server.route({
        method: 'GET',
        path: '/addresses',

        async handler(request) {
            // permissions check
            let permission;
            let ownOnly = false;
            permission = roles.can(request.app.role).readAny('addresslisting');
            if (!permission.granted && request.app.user) {
                permission = roles.can(request.app.role).readOwn('addresslisting');
                if (permission.granted) {
                    ownOnly = true;
                }
            }
            request.validateAcl(permission);

            let query = request.query.query;
            let forward = request.query.forward;
            let limit = request.query.limit;
            let page = request.query.page;
            let pageNext = request.query.next;
            let pagePrevious = request.query.previous;

            let filter =
                (query && {
                    address: {
                        // cannot use dotless version as this would break domain search
                        $regex: escapeRegexStr(query),
                        $options: ''
                    }
                }) ||
                {};

            if (forward) {
                filter['targets.value'] = {
                    $regex: escapeRegexStr(forward),
                    $options: ''
                };
            }

            let requiredTags = (request.query.requiredTags || '').split(',').filter(tag => tag);
            let tags = (request.query.tags || '').split(',').filter(tag => tag);

            let tagsview = {};
            if (requiredTags.length) {
                tagsview.$all = requiredTags.map(tag => tag.toLowerCase());
            }

            if (tags.length) {
                tagsview.$in = tags.map(tag => tag.toLowerCase());
            }

            if (requiredTags.length || tags.length) {
                filter.tagsview = tagsview;
            }

            if (ownOnly) {
                filter.user = new ObjectId(request.app.user);
            }

            let total = await db.users.collection('addresses').countDocuments(filter);
            let opts = {
                limit,
                query: filter,
                fields: {
                    addrview: true,
                    // FIXME: MongoPaging inserts fields value as second argument to col.find()
                    projection: {
                        _id: true,
                        address: true,
                        addrview: true,
                        name: true,
                        user: true,
                        tags: true,
                        targets: true,
                        forwardedDisabled: true
                    }
                },
                paginatedField: 'addrview',
                sortAscending: true
            };

            if (request.query.metaData) {
                opts.fields.projection.metaData = true;
            }

            if (request.query.internalData) {
                opts.fields.projection.internalData = true;
            }

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.users.collection('addresses'), opts);
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
                results: (listing.results || []).map(addressData => {
                    let values = {
                        id: addressData._id.toString(),
                        name: addressData.name || false,
                        address: addressData.address,
                        user: addressData.user && addressData.user.toString(),
                        forwarded: !!addressData.targets,
                        forwardedDisabled: !!(addressData.targets && addressData.forwardedDisabled),
                        targets: addressData.targets && addressData.targets.map(t => t.value),
                        tags: addressData.tags || []
                    };

                    if (addressData.metaData) {
                        values.metaData = formatMetaData(addressData.metaData);
                    }

                    if (addressData.internalData) {
                        values.internalData = formatMetaData(addressData.internalData);
                    }

                    return permission.filter(values);
                })
            };

            return response;
        },

        options: {
            description: 'List registered addresses',
            notes: 'List registered addresses',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                query: Joi.object({
                    query: Joi.string().empty('').lowercase().max(255).example('myuser').description('Partial match of the email address'),
                    forward: Joi.string().empty('').lowercase().max(255).description('Partial match of a forward email address or URL'),
                    tags: tagsSchema.empty('').description('Comma separated list of tags. The address must have at least one to be set'),
                    requiredTags: tagsSchema.empty('').description('Comma separated list of tags. The address must have all listed tags to be set'),
                    metaData: booleanSchema.description('If true, then includes metaData in the response'),
                    internalData: booleanSchema.description('If true, then includes internalData in the response. Not shown for user-role tokens.'),

                    limit: pageLimitSchema,
                    next: nextPageCursorSchema,
                    previous: previousPageCursorSchema,
                    page: pageNrSchema
                }).label('ListAddressesQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().example('myuser').description('Requested partial match'),
                    total: Joi.number().required().example(123).description('How many addresses were found'),
                    page: Joi.number().required().example(1).description('Current response page'),
                    previousCursor: previousPageCursorSchema.allow(false),
                    nextCursor: nextPageCursorSchema.allow(false),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: mongoIdSchema.description('Address ID').required(),
                                name: userNameSchema.description('Identity name').allow(false),
                                address: Joi.string().email().example('john@example.com').description('Email address'),
                                tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with the user'),
                                targets: forwardTargetSchema,

                                user: userIdSchema.description('User ID this address belongs to if this is a user address'),
                                forwarded: booleanSchema.description('Is it a forwarded address'),
                                forwardedDisabled: booleanSchema.description('Is the address forwarded but forwarding is disabled'),

                                metaData: Joi.object().description('Custom metadata value. Included if "metaData" query argument was "true"'),
                                internalData: Joi.object().description(
                                    'Custom metadata value for internal use. Included if "internalData" query argument was "true" and request was not made using a user-role token'
                                )
                            }).label('AddressesListItem')
                        )
                        .description('Result listing')
                        .label('AddressesListItems')
                }).label('ListAddressesQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/users/{user}/addresses',

        async handler(request, h) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).createOwn('addresses');
            } else {
                permission = roles.can(request.app.role).createAny('addresses');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);

            let main = request.payload.main;
            let name = request.payload.name;
            let address = normalizeAddress(request.payload.address);

            if (address.indexOf('+') >= 0) {
                return inputValidationError(request, h, 'address', 'Address can not contain +');
            }

            let isWildcard = checkWildcardAddress(address, request.payload.allowWildcard);
            if (main && isWildcard) {
                return inputValidationError(request, h, 'address', 'Main address for an account can not be a wildcard address');
            }

            let userData;
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
                let error = Boom.boomify(err, { statusCode: 500 });
                error.output.payload.code = err.code || 'InternalError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    addrview: uview(address)
                });
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: 500 });
                error.output.payload.code = err.code || 'InternalError';
                throw error;
            }

            if (addressData) {
                let error = Boom.boomify(new Error('This email address already exists'), { statusCode: 400 });
                error.output.payload.code = 'AddressExistsError';
                throw error;
            }

            addressData = {
                user,
                name,
                address,
                addrview: uview(address),
                created: new Date()
            };

            if (request.payload.tags) {
                addressData.tags = request.payload.tags;
                addressData.tagsview = request.payload.tags.map(tag => tag.toLowerCase());
            }

            if (request.payload.metaData) {
                addressData.metaData = request.payload.metaData;
            }

            if (request.payload.internalData) {
                addressData.internalData = request.payload.internalData;
            }

            let r;
            // insert alias address to email address registry
            try {
                r = await db.users.collection('addresses').insertOne(addressData);
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: 500 });
                error.output.payload.code = err.code || 'InternalError';
                throw error;
            }

            let insertId = r.insertedId;

            if (!userData.address || main) {
                // try to register this address as the default address for that user
                try {
                    await db.users.collection('users').updateOne(
                        {
                            _id: user
                        },
                        {
                            $set: {
                                address
                            }
                        }
                    );
                } catch (err) {
                    // ignore
                }
            }

            await publish(db.redis, {
                ev: ADDRESS_USER_CREATED,
                user,
                address: insertId,
                value: addressData.address
            });

            return {
                success: !!insertId,
                id: insertId && insertId.toString()
            };
        },

        options: {
            description: 'Create an address',
            notes: 'Add a new email address for a user. Addresses can contain unicode characters. Dots in usernames are normalized so no need to create both "firstlast@example.com" and "first.last@example.com". Special addresses `*@example.com`, `*suffix@example.com` and `username@*` catch all emails to these domains or users without a registered destination (requires `allowWildcard` argument)',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required()
                }).label('UserParams'),

                payload: Joi.object({
                    address: Joi.alternatives()
                        .try(Joi.string().email({ tlds: false }), Joi.string().regex(/^\w+@\*$/, 'special address'))
                        .required()
                        .example('john@example.com')
                        .description('E-mail Address')
                        .label('CreateAddressAddress'),
                    name: userNameSchema.description('Identity name'),
                    main: booleanSchema.description('Indicates if this is the default address for the user'),
                    allowWildcard: booleanSchema.description(
                        'If true then address value can be in the form of `*@example.com`, `*suffix@example.com` or `username@*`, otherwise using `*` as part of the address is not allowed. Static suffix can be up to 32 characters long.'
                    ),
                    tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with this address'),
                    metaData: metaDataSchema
                        .label('metaData')
                        .example({ accountIcon: 'avatar.png' })
                        .description('Optional metadata, must be an object or JSON formatted string'),
                    internalData: metaDataSchema
                        .label('internalData')
                        .example({ inTrial: true })
                        .description(
                            'Optional metadata for internal use, must be an object or JSON formatted string of an object. Not available for user-role tokens'
                        )
                }).label('CreateAddressPayload')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: mongoIdSchema.description('Address ID').required()
                }).label('CreateAddressReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/users/{user}/addresses',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).readOwn('addresses');
            } else {
                permission = roles.can(request.app.role).readAny('addresses');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            name: true,
                            address: true
                        }
                    }
                );
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: 500 });
                error.output.payload.code = err.code || 'InternalError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let addresses;

            try {
                addresses = await db.users
                    .collection('addresses')
                    .find({
                        user
                    })
                    .sort({
                        addrview: 1
                    })
                    .toArray();
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: 500 });
                error.output.payload.code = err.code || 'InternalError';
                throw error;
            }

            if (!addresses) {
                addresses = [];
            }

            return {
                success: true,

                results: addresses.map(addressData => {
                    let values = {
                        id: addressData._id.toString(),
                        name: addressData.name || false,
                        address: addressData.address,
                        main: addressData.address === userData.address,
                        tags: addressData.tags || [],
                        created: addressData.created
                    };

                    if (request.query.metaData && addressData.metaData) {
                        values.metaData = formatMetaData(addressData.metaData);
                    }

                    if (request.query.internalData && addressData.internalData) {
                        values.internalData = formatMetaData(addressData.internalData);
                    }

                    return permission.filter(values);
                })
            };
        },

        options: {
            description: 'List registered addresses for a user',
            notes: 'List all addresses registered for the requested users. This endpoint does not use paging.',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required()
                }).label('UserParams'),

                query: Joi.object({
                    metaData: booleanSchema.description('If true, then includes metaData in the response'),
                    internalData: booleanSchema.description('If true, then includes internalData in the response. Not shown for user-role tokens.')
                }).label('ListUserAddressesQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().example('myuser').description('Requested partial match'),
                    total: Joi.number().required().example(123).description('How many addresses were found'),
                    page: Joi.number().required().example(1).description('Current response page'),
                    previousCursor: previousPageCursorSchema.allow(false),
                    nextCursor: nextPageCursorSchema.allow(false),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: mongoIdSchema.description('Address ID').required(),
                                name: userNameSchema.description('Identity name').allow(false),
                                address: Joi.string().email().example('john@example.com').description('Email address'),
                                main: booleanSchema.description('Indicates if this is the default address for the user'),
                                tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with the user'),
                                created: Joi.date().empty('').example('2021-12-29T09:49:54.853Z').description('Time this address was created'),

                                metaData: Joi.object().description('Custom metadata value. Included if "metaData" query argument was "true"'),
                                internalData: Joi.object().description(
                                    'Custom metadata value for internal use. Included if "internalData" query argument was "true" and request was not made using a user-role token'
                                )
                            }).label('UserAddressesListItem')
                        )
                        .description('Result listing')
                        .label('UserAddressesListItems')
                }).label('ListUserAddressesQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/users/{user}/addresses/{address}',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).readOwn('addresses');
            } else {
                permission = roles.can(request.app.role).readAny('addresses');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);
            let address = new ObjectId(request.params.address);

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            name: true,
                            address: true
                        }
                    }
                );
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: 500 });
                error.output.payload.code = err.code || 'InternalError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: address,
                    user
                });
            } catch (err) {
                let error = Boom.boomify(err, { statusCode: 500 });
                error.output.payload.code = err.code || 'InternalError';
                throw error;
            }
            if (!addressData) {
                let error = Boom.boomify(new Error('Invalid or unknown address'), { statusCode: 404 });
                error.output.payload.code = 'AddressNotFound';
                throw error;
            }

            let value = {
                success: true,
                id: addressData._id.toString(),
                name: addressData.name || false,
                address: addressData.address,
                main: addressData.address === userData.address,
                tags: addressData.tags || [],
                created: addressData.created
            };

            if (addressData.metaData) {
                value.metaData = formatMetaData(addressData.metaData);
            }

            if (addressData.internalData) {
                value.internalData = formatMetaData(addressData.internalData);
            }

            return permission.filter(value);
        },

        options: {
            description: 'Request address information',
            notes: 'Retrieve information about an address that belongs to a user.',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required(),
                    address: mongoIdSchema.required().description('ID of the Address')
                }).label('UserAddressParams'),

                query: Joi.object({
                    metaData: booleanSchema.description('If true, then includes metaData in the response'),
                    internalData: booleanSchema.description('If true, then includes internalData in the response. Not shown for user-role tokens.')
                }).label('GetUserAddressQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: mongoIdSchema.description('Address ID').required(),
                    name: userNameSchema.description('Identity name').allow(false),
                    address: Joi.string().email().example('john@example.com').description('Email address'),
                    main: booleanSchema.description('Indicates if this is the default address for the user'),
                    tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with the user'),
                    created: Joi.date().empty('').example('2021-12-29T09:49:54.853Z').description('Time this address was created'),

                    metaData: Joi.object().description('Custom metadata value. Included if "metaData" query argument was "true"'),
                    internalData: Joi.object().description(
                        'Custom metadata value for internal use. Included if "internalData" query argument was "true" and request was not made using a user-role token'
                    )
                }).label('GetUserAddressQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'PUT',
        path: '/users/{user}/addresses/{address}',

        async handler(request, h) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).updateOwn('addresses');
            } else {
                permission = roles.can(request.app.role).updateAny('addresses');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);
            let address = new ObjectId(request.params.address);

            let values = permission.filter(request.payload);

            let main = values.main;

            if (main === false) {
                return inputValidationError(request, h, 'main', 'Cannot unset main status');
            }

            let updates = {};

            if (values.address) {
                updates.address = normalizeAddress(values.address);
                updates.addrview = uview(updates.address);
            }

            if (values.name) {
                updates.name = values.name;
            }

            if (values.tags) {
                updates.tags = values.tags;
                updates.tagsview = values.tags.map(tag => tag.toLowerCase());
            }

            let userData;
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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: address,
                    user
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!addressData) {
                let error = Boom.boomify(new Error('Invalid or unknown email address identifier'), { statusCode: 404 });
                error.output.payload.code = 'AddressNotFound';
                throw error;
            }

            if (addressData.address.indexOf('*') >= 0 && values.address && values.address !== addressData.address) {
                let error = Boom.boomify(new Error('Can not change special address'), { statusCode: 400 });
                error.output.payload.code = 'ChangeNotAllowed';
                throw error;
            }

            if (values.address && values.address.indexOf('*') >= 0 && values.address !== addressData.address) {
                let error = Boom.boomify(new Error('Can not change special address'), { statusCode: 400 });
                error.output.payload.code = 'ChangeNotAllowed';
                throw error;
            }

            if ((values.address || addressData.address).indexOf('*') >= 0 && main) {
                let error = Boom.boomify(new Error('Can not set wildcard address as default'), { statusCode: 400 });
                error.output.payload.code = 'WildcardNotPermitted';
                throw error;
            }

            if (values.address && addressData.address === userData.address && values.address !== addressData.address) {
                // main address was changed, update user data as well
                main = true;
                addressData.address = values.address;
            }

            for (let key of ['metaData', 'internalData']) {
                if (values[key]) {
                    updates[key] = values[key];
                }
            }

            if (Object.keys(updates).length) {
                try {
                    await db.users.collection('addresses').updateOne(
                        {
                            _id: addressData._id
                        },
                        {
                            $set: updates
                        }
                    );
                } catch (err) {
                    if (err.code === 11000) {
                        let error = Boom.boomify(new Error('Address already exists'), { statusCode: 400 });
                        error.output.payload.code = 'AddressExistsError';
                        throw error;
                    }

                    let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                    error.output.payload.code = 'InternalDatabaseError';
                    throw error;
                }
            }

            if (main) {
                try {
                    await db.users.collection('users').updateOne(
                        {
                            _id: user
                        },
                        {
                            $set: {
                                address: addressData.address
                            }
                        }
                    );
                } catch (err) {
                    // not sure if should throw or not
                    request.logger.error({
                        msg: 'Failed to update user',
                        query: {
                            _id: user.toString()
                        },
                        update: {
                            address: addressData.address
                        },
                        err
                    });
                }
            }

            return {
                success: true,
                id: addressData._id.toString()
            };
        },

        options: {
            description: 'Update address information',
            notes: 'Update an existing email address',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required(),
                    address: mongoIdSchema.required().description('ID of the Address')
                }).label('UserAddressParams'),

                payload: Joi.object({
                    address: Joi.string()
                        .email()
                        .example('john@example.com')
                        .description(
                            'New address if you want to rename existing address. Only affects normal addresses, special addresses that include a wildcard can not be changed'
                        ),
                    name: userNameSchema.description('Identity name'),
                    main: booleanSchema.description('Indicates if this is the default address for the user'),
                    tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with this address'),
                    metaData: metaDataSchema
                        .label('metaData')
                        .example({ accountIcon: 'avatar.png' })
                        .description('Optional metadata, must be an object or JSON formatted string'),
                    internalData: metaDataSchema
                        .label('internalData')
                        .example({ inTrial: true })
                        .description(
                            'Optional metadata for internal use, must be an object or JSON formatted string of an object. Not available for user-role tokens'
                        )
                }).label('UpdateAddressPayload')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: mongoIdSchema.description('Address ID').required()
                }).label('UpdateAddressReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'DELETE',
        path: '/users/{user}/addresses/{address}',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).deleteOwn('addresses');
            } else {
                permission = roles.can(request.app.role).deleteAny('addresses');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);
            let address = new ObjectId(request.params.address);

            let userData;
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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: address,
                    user
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!addressData) {
                let error = Boom.boomify(new Error('Invalid or unknown email address identifier'), { statusCode: 404 });
                error.output.payload.code = 'AddressNotFound';
                throw error;
            }

            if (addressData.address === userData.address) {
                let error = Boom.boomify(new Error('Can not delete main address'), { statusCode: 400 });
                error.output.payload.code = 'NotPermitted';
                throw error;
            }

            // delete address from email address registry
            let r;
            try {
                r = await db.users.collection('addresses').deleteOne({
                    _id: address
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (r.deletedCount) {
                await publish(db.redis, {
                    ev: ADDRESS_USER_DELETED,
                    user,
                    address,
                    value: addressData.address
                });
            }

            return {
                success: !!r.deletedCount,
                id: addressData._id.toString()
            };
        },

        options: {
            description: 'Delete an address',
            notes: 'This method deletes an address reference form the user account. You can then recycle this address.',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required(),
                    address: mongoIdSchema.required().description('ID of the Address')
                }).label('UserAddressParams')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: mongoIdSchema.description('Address ID').required()
                }).label('DeleteAddressReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/users/{user}/addressregister',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).readOwn('addresses');
            } else {
                permission = roles.can(request.app.role).readAny('addresses');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);

            let query = request.query.query;
            let limit = request.query.limit;

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            _id: true,
                            name: true,
                            address: true
                        }
                    }
                );
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let addresses;
            try {
                addresses = await db.database
                    .collection('addressregister')
                    .find(
                        query
                            ? {
                                  user,
                                  $or: [
                                      {
                                          address: {
                                              // cannot use dotless version as this would break domain search
                                              $regex: '^' + escapeRegexStr(query),
                                              $options: ''
                                          }
                                      },
                                      {
                                          name: {
                                              // cannot use dotless version as this would break domain search
                                              $regex: '^' + escapeRegexStr(query),
                                              $options: 'i'
                                          }
                                      }
                                  ]
                              }
                            : { user },
                        {
                            sort: { updated: -1 },
                            projection: {
                                name: true,
                                address: true
                            },
                            limit
                        }
                    )
                    .toArray();
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!addresses) {
                addresses = [];
            }

            return {
                success: true,
                query,

                results: addresses.map(addressData => {
                    let name = addressData.name || false;
                    try {
                        // try to decode
                        if (name) {
                            name = decodeWords(name);
                        }
                    } catch (E) {
                        // ignore
                    }
                    return {
                        id: addressData._id.toString(),
                        name: addressData.name || false,
                        address: addressData.address
                    };
                })
            };
        },

        options: {
            description: 'List addresses from communications registry',
            notes: 'List matching addresses from the communications registry, sorted by recent interaction. This is useful when autocompleting addresses in the recipient field.',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                query: Joi.object({
                    query: Joi.string().empty('').lowercase().max(255).example('myuser').description('Prefix of an address or a name').label('QueryPrefix'),

                    limit: pageLimitSchema
                }).label('ListAddressRegistryQuery'),

                params: Joi.object({
                    user: userIdSchema.required()
                }).label('UserParams')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().empty('').lowercase().max(255).example('myuser').description('Prefix of an address or a name').label('QueryPrefix'),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: mongoIdSchema.description('Address ID').required(),
                                name: userNameSchema.description('Identity name').allow(false),
                                address: Joi.string().email().example('john@example.com').description('Email address')
                            }).label('AddressRegistryItem')
                        )
                        .description('Result listing')
                        .label('AddressRegistryItems')
                }).label('ListAddressRegistryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/addresses/forwarded',

        async handler(request, h) {
            // permissions check
            let permission = roles.can(request.app.role).createAny('addresses');
            request.validateAcl(permission);

            let name = request.payload.name;
            let address = normalizeAddress(request.payload.address);
            let addrview = uview(address);

            let forwards = request.payload.forwards;

            if (request.payload.autoreply) {
                if (request.payload.autoreply.text === '' && !request.payload.autoreply.html) {
                    request.payload.autoreply.html = '';
                }

                if (request.payload.autoreply.html === '' && !request.payload.autoreply.text) {
                    // make sure we also update plaintext part
                    request.payload.autoreply.text = '';
                }
            } else {
                request.payload.autoreply = {
                    status: false
                };
            }

            let targets = [];
            // reformat targets array
            if (request.payload.targets && request.payload.targets.length) {
                targets = request.payload.targets
                    .map(target => {
                        if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                            // email

                            return {
                                id: new ObjectId(),
                                type: 'mail',
                                value: target
                            };
                        } else if (/^smtps?:/i.test(target)) {
                            return {
                                id: new ObjectId(),
                                type: 'relay',
                                value: target
                            };
                        } else if (/^https?:/i.test(target)) {
                            return {
                                id: new ObjectId(),
                                type: 'http',
                                value: target
                            };
                        }
                    })
                    .filter(target => target);
            }

            if (address.indexOf('+') >= 0) {
                return inputValidationError(request, h, 'address', 'Address can not contain +');
            }

            checkWildcardAddress(address, request.payload.allowWildcard);

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    addrview
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (addressData) {
                let error = Boom.boomify(new Error('This email address already exists'), { statusCode: 400 });
                error.output.payload.code = 'AddressExistsError';
                throw error;
            }

            // insert alias address to email address registry
            addressData = {
                name,
                address,
                addrview: uview(address),
                targets,
                forwards,
                autoreply: request.payload.autoreply,
                created: new Date()
            };

            if (request.payload.tags) {
                addressData.tags = request.payload.tags;
                addressData.tagsview = addressData.tags.map(tag => tag.toLowerCase());
            }

            if (request.payload.metaData) {
                addressData.metaData = formatMetaData(request.payload.metaData);
            }

            if (request.payload.internalData) {
                addressData.internalData = formatMetaData(request.payload.internalData);
            }

            let r;

            try {
                r = await db.users.collection('addresses').insertOne(addressData);
            } catch (err) {
                if (err.code === 11000) {
                    let error = Boom.boomify(new Error('Address already exists'), { statusCode: 400 });
                    error.output.payload.code = 'AddressExistsError';
                    throw error;
                } else {
                    let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                    error.output.payload.code = 'InternalDatabaseError';
                    throw error;
                }
            }

            const insertId = r.insertedId;

            await publish(db.redis, {
                ev: ADDRESS_FORWARDED_CREATED,
                address: insertId,
                value: addressData.address
            });

            return {
                success: !!insertId,
                id: insertId
            };
        },

        options: {
            description: 'Create a new forwarded address',
            notes: 'Add a new forwarded email address. Addresses can contain Unicode characters. Dots in usernames are normalized, so there is no need to create both `firstlast@example.com` and `first.last@example.com`. Special addresses `*@example.com` and `username@*` catch all emails to these domains or users without a registered destination (requires `allowWildcard` argument)',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                payload: Joi.object({
                    address: Joi.alternatives()
                        .try(Joi.string().email({ tlds: false }), Joi.string().regex(/^\w+@\*$/, 'special address'))
                        .required()
                        .example('john@example.com')
                        .description('E-mail Address')
                        .label('CreateAddressAddress'),
                    name: userNameSchema.description('Identity name'),
                    targets: forwardTargetSchema,
                    forwards: Joi.number().min(0).default(0).example(1200).description('Daily allowed forwarding count for this address'),
                    allowWildcard: booleanSchema.description(
                        'If true then address value can be in the form of `*@example.com`, `*suffix@example.com` or `username@*`, otherwise using `*` as part of the address is not allowed. Static suffix can be up to 32 characters long.'
                    ),
                    autoreply: autoreplySchema,
                    tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with this address'),
                    metaData: metaDataSchema
                        .label('metaData')
                        .example({ accountIcon: 'avatar.png' })
                        .description('Optional metadata, must be an object or JSON formatted string'),
                    internalData: metaDataSchema
                        .label('internalData')
                        .example({ inTrial: true })
                        .description(
                            'Optional metadata for internal use, must be an object or JSON formatted string of an object. Not available for user-role tokens'
                        )
                }).label('CreateForwardedPayload')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: mongoIdSchema.description('Address ID').required()
                }).label('CreateAddressReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'PUT',
        path: '/addresses/forwarded/{address}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).updateAny('addresses');
            request.validateAcl(permission);

            let address = new ObjectId(request.params.address);

            let updates = {};
            if (request.payload.address) {
                updates.address = normalizeAddress(request.params.address);
                updates.addrview = uview(request.params.address);
            }

            if (request.payload.forwards) {
                updates.forwards = request.payload.forwards;
            }

            if (request.payload.name) {
                updates.name = request.payload.name;
            }

            if (request.payload.forwardedDisabled !== undefined) {
                updates.forwardedDisabled = request.payload.forwardedDisabled;
            }

            if (request.payload.autoreply) {
                if (request.payload.autoreply.text === '' && !request.payload.autoreply.html) {
                    request.payload.autoreply.html = '';
                }

                if (request.payload.autoreply.html === '' && !request.payload.autoreply.text) {
                    // make sure we also update plaintext part
                    request.payload.autoreply.text = '';
                }

                Object.keys(request.payload.autoreply).forEach(key => {
                    updates['autoreply.' + key] = request.payload.autoreply[key];
                });
            }

            if (request.payload.tags) {
                updates.tags = request.payload;
                updates.tagsview = request.payload.tags.map(tag => tag.toLowerCase());
            }

            if (request.payload.metaData) {
                updates.metaData = formatMetaData(request.payload.metaData);
            }

            if (request.payload.internalData) {
                updates.internalData = formatMetaData(request.payload.internalData);
            }

            let addressData;

            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: address
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!addressData || !addressData.targets || addressData.user) {
                let error = Boom.boomify(new Error('Invalid or unknown email address identifier'), { statusCode: 404 });
                error.output.payload.code = 'AddressNotFound';
                throw error;
            }

            if (addressData.address.indexOf('*') >= 0 && request.payload.address && request.payload.address !== addressData.address) {
                let error = Boom.boomify(new Error('Can not change special address'), { statusCode: 400 });
                error.output.payload.code = 'ChangeNotAllowed';
                throw error;
            }

            if (request.payload.address && request.payload.address.indexOf('*') >= 0 && request.payload.address !== addressData.address) {
                let error = Boom.boomify(new Error('Can not change special address'), { statusCode: 400 });
                error.output.payload.code = 'ChangeNotAllowed';
                throw error;
            }

            // reformat targets array
            if (request.payload.targets && request.payload.targets.length) {
                updates.targets = request.payload.targets
                    .map(target => {
                        if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                            // email

                            return {
                                id: new ObjectId(),
                                type: 'mail',
                                value: target
                            };
                        } else if (/^smtps?:/i.test(target)) {
                            return {
                                id: new ObjectId(),
                                type: 'relay',
                                value: target
                            };
                        } else if (/^https?:/i.test(target)) {
                            return {
                                id: new ObjectId(),
                                type: 'http',
                                value: target
                            };
                        }
                    })
                    .filter(target => target);
            }

            // insert forwarded address to email address registry
            let r;
            try {
                r = await db.users.collection('addresses').updateOne(
                    {
                        _id: addressData._id
                    },
                    {
                        $set: updates
                    }
                );
            } catch (err) {
                if (err.code === 11000) {
                    let error = Boom.boomify(new Error('Address already exists'), { statusCode: 400 });
                    error.output.payload.code = 'AddressExistsError';
                    throw error;
                } else {
                    let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                    error.output.payload.code = 'InternalDatabaseError';
                    throw error;
                }
            }

            return {
                success: !!r.matchedCount,
                id: addressData._id.toString()
            };
        },

        options: {
            description: 'Update forwarded address information',
            notes: 'Update settings for an existing forwarded address',
            tags: ['api', 'Addresses'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    address: mongoIdSchema.required().description('Address ID')
                }).label('AddressParams'),

                payload: Joi.object({
                    address: Joi.string()
                        .email({ tlds: false })
                        .example('john@example.com')
                        .description('New address. Only affects normal addresses, special addresses that include * can not be changed')
                        .label('UpdateForwardedAddressAddress'),
                    name: userNameSchema.description('Identity name'),
                    targets: forwardTargetSchema,
                    forwards: Joi.number().min(0).default(0).example(1200).description('Daily allowed forwarding count for this address'),
                    autoreply: autoreplySchema,
                    tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with this address'),
                    metaData: metaDataSchema
                        .label('metaData')
                        .example({ accountIcon: 'avatar.png' })
                        .description('Optional metadata, must be an object or JSON formatted string'),
                    internalData: metaDataSchema
                        .label('internalData')
                        .example({ inTrial: true })
                        .description(
                            'Optional metadata for internal use, must be an object or JSON formatted string of an object. Not available for user-role tokens'
                        )
                }).label('UpdateForwardedPayload')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: mongoIdSchema.description('Address ID').required()
                }).label('CreateAddressReponse'),
                failAction: 'log'
            }
        }
    });

    /*
    server.del(
        '/addresses/forwarded/:address',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                address: Joi.string().hex().lowercase().length(24).required()
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
            req.validate(roles.can(req.role).deleteAny('addresses'));

            let address = new ObjectId(result.value.address);

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: address
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!addressData || !addressData.targets || addressData.user) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown email address identifier',
                    code: 'AddressNotFound'
                });
                return next();
            }

            // delete address from email address registry
            let r;
            try {
                r = await db.users.collection('addresses').deleteOne({
                    _id: address
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
                    ev: ADDRESS_FORWARDED_DELETED,
                    address,
                    value: addressData.address
                });
            }

            res.json({
                success: !!r.deletedCount
            });
            return next();
        })
    );

    server.get(
        '/addresses/forwarded/:address',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                address: Joi.string().hex().lowercase().length(24).required()
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
            const permission = roles.can(req.role).readAny('addresses');
            req.validate(permission);

            let address = new ObjectId(result.value.address);

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: address
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!addressData || !addressData.targets || addressData.user) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown address',
                    code: 'AddressNotFound'
                });
                return next();
            }

            let response;
            try {
                response = await db.redis
                    .multi()
                    // sending counters are stored in Redis
                    .get('wdf:' + addressData._id.toString())
                    .ttl('wdf:' + addressData._id.toString())
                    .exec();
            } catch (err) {
                // ignore
            }

            let settings = await settingsHandler.getMulti(['const:max:forwards']);

            let forwards = Number(addressData.forwards) || config.maxForwards || settings['const:max:forwards'];

            let forwardsSent = Number(response && response[0] && response[0][1]) || 0;
            let forwardsTtl = Number(response && response[1] && response[1][1]) || 0;

            const values = {
                success: true,
                id: addressData._id.toString(),
                name: addressData.name || false,
                address: addressData.address,
                targets: addressData.targets && addressData.targets.map(t => t.value),
                limits: {
                    forwards: {
                        allowed: forwards,
                        used: forwardsSent,
                        ttl: forwardsTtl >= 0 ? forwardsTtl : false
                    }
                },
                autoreply: addressData.autoreply || { status: false },
                tags: addressData.tags || [],
                forwardedDisabled: addressData.targets && addressData.forwardedDisabled,
                created: addressData.created
            };

            if (addressData.metaData) {
                values.metaData = tools.formatMetaData(addressData.metaData);
            }

            if (addressData.internalData) {
                values.internalData = tools.formatMetaData(addressData.internalData);
            }

            res.json(permission.filter(values));

            return next();
        })
    );

    server.get(
        '/addresses/resolve/:address',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                address: [Joi.string().hex().lowercase().length(24).required(), Joi.string().email({ tlds: false })],
                allowWildcard: booleanSchema
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
            const permission = roles.can(req.role).readAny('addresses');
            req.validate(permission);

            let addressData;
            try {
                if (result.value.address.indexOf('@') >= 0) {
                    addressData = await userHandler.asyncResolveAddress(result.value.address, {
                        wildcard: result.value.allowWildcard,
                        projection: false
                    });
                } else {
                    addressData = await db.users.collection('addresses').findOne({
                        _id: new ObjectId(result.value.address)
                    });
                }
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!addressData) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown address',
                    code: 'AddressNotFound'
                });
                return next();
            }

            if (addressData.user) {
                const values = {
                    success: true,
                    id: addressData._id.toString(),
                    address: addressData.address,
                    user: addressData.user.toString(),
                    tags: addressData.tags || [],
                    created: addressData.created
                };

                if (addressData.metaData) {
                    values.metaData = tools.formatMetaData(addressData.metaData);
                }

                if (addressData.internalData) {
                    values.internalData = tools.formatMetaData(addressData.internalData);
                }

                res.json(permission.filter(values));
                return next();
            }

            let response;
            try {
                response = await db.redis
                    .multi()
                    // sending counters are stored in Redis
                    .get('wdf:' + addressData._id.toString())
                    .ttl('wdf:' + addressData._id.toString())
                    .exec();
            } catch (err) {
                // ignore
            }

            let settings = await settingsHandler.getMulti(['const:max:forwards']);

            let forwards = Number(addressData.forwards) || config.maxForwards || settings['const:max:forwards'];

            let forwardsSent = Number(response && response[0] && response[0][1]) || 0;
            let forwardsTtl = Number(response && response[1] && response[1][1]) || 0;

            const values = {
                success: true,
                id: addressData._id.toString(),
                name: addressData.name || '',
                address: addressData.address,
                targets: addressData.targets && addressData.targets.map(t => t.value),
                limits: {
                    forwards: {
                        allowed: forwards,
                        used: forwardsSent,
                        ttl: forwardsTtl >= 0 ? forwardsTtl : false
                    }
                },
                autoreply: addressData.autoreply || { status: false },
                tags: addressData.tags || [],
                created: addressData.created
            };

            if (addressData.metaData) {
                values.metaData = tools.formatMetaData(addressData.metaData);
            }

            if (addressData.internalData) {
                values.internalData = tools.formatMetaData(addressData.internalData);
            }

            res.json(permission.filter(values));
            return next();
        })
    );

    server.put(
        '/addresses/renameDomain',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                oldDomain: Joi.string().required(),
                newDomain: Joi.string().required()
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
            req.validate(roles.can(req.role).updateAny('addresses'));

            let oldDomain = tools.normalizeDomain(result.value.oldDomain);
            let newDomain = tools.normalizeDomain(result.value.newDomain);

            let updateAddresses = [];
            let updateUsers = [];

            let cursor = await db.users.collection('addresses').find({
                addrview: {
                    $regex: '@' + tools.escapeRegexStr(oldDomain) + '$'
                }
            });

            let response = {
                success: true,
                modifiedAddresses: 0,
                modifiedUsers: 0,
                modifiedDkim: 0,
                modifiedAliases: 0
            };

            let addressData;
            try {
                while ((addressData = await cursor.next())) {
                    updateAddresses.push({
                        updateOne: {
                            filter: {
                                _id: addressData._id
                            },
                            update: {
                                $set: {
                                    address: addressData.address.replace(/@.+$/, () => '@' + newDomain),
                                    addrview: addressData.addrview.replace(/@.+$/, () => '@' + newDomain)
                                }
                            }
                        }
                    });

                    updateUsers.push({
                        updateOne: {
                            filter: {
                                _id: addressData.user,
                                address: addressData.address
                            },
                            update: {
                                $set: {
                                    address: addressData.address.replace(/@.+$/, () => '@' + newDomain)
                                }
                            }
                        }
                    });
                }

                await cursor.close();
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (updateAddresses.length) {
                try {
                    let r = await db.users.collection('addresses').bulkWrite(updateAddresses, {
                        ordered: false,
                        writeConcern: 1
                    });
                    response.modifiedAddresses = r.modifiedCount;
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                try {
                    let r = await db.users.collection('users').bulkWrite(updateUsers, {
                        ordered: false,
                        writeConcern: 1
                    });
                    response.modifiedUsers = r.modifiedCount;
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
            }

            // UPDATE DKIM
            try {
                let r = await db.database.collection('dkim').updateMany(
                    {
                        domain: oldDomain
                    },
                    {
                        $set: {
                            domain: newDomain
                        }
                    }
                );
                response.modifiedDkim = r.modifiedCount;
            } catch (err) {
                log.error('RenameDomain', 'DKIMERR old=%s new=%s error=%s', oldDomain, newDomain, err.message);
            }

            // UPDATE ALIASES
            try {
                let r = await db.users.collection('domainaliases').updateMany(
                    {
                        domain: oldDomain
                    },
                    {
                        $set: {
                            domain: newDomain
                        }
                    }
                );
                response.modifiedAliases = r.modifiedCount;
            } catch (err) {
                log.error('RenameDomain', 'ALIASERR old=%s new=%s error=%s', oldDomain, newDomain, err.message);
            }

            await publish(db.redis, {
                ev: ADDRESS_DOMAIN_RENAMED,
                previous: oldDomain,
                current: newDomain
            });

            res.json(response);
        })
    );
    */
};
