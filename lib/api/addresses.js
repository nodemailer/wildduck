'use strict';

const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const consts = require('../consts');
const roles = require('../roles');
const libmime = require('libmime');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema, metaDataSchema } = require('../schemas');
const log = require('npmlog');
const isemail = require('isemail');
const {
    publish,
    ADDRESS_USER_CREATED,
    ADDRESS_USER_DELETED,
    ADDRESS_FORWARDED_CREATED,
    ADDRESS_FORWARDED_DELETED,
    ADDRESS_DOMAIN_RENAMED
} = require('../events');

module.exports = (db, server, userHandler, settingsHandler) => {
    server.get(
        { name: 'addresses', path: '/addresses' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                query: Joi.string().trim().empty('').max(255),
                forward: Joi.string().trim().empty('').max(255),
                tags: Joi.string().trim().empty('').max(1024),
                requiredTags: Joi.string().trim().empty('').max(1024),
                metaData: booleanSchema,
                internalData: booleanSchema,
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
            let permission;
            let ownOnly = false;
            permission = roles.can(req.role).readAny('addresslisting');
            if (!permission.granted && req.user && ObjectId.isValid(req.user)) {
                permission = roles.can(req.role).readOwn('addresslisting');
                if (permission.granted) {
                    ownOnly = true;
                }
            }
            // permissions check
            req.validate(permission);

            let query = result.value.query;
            let forward = result.value.forward;
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter =
                (query && {
                    address: {
                        // cannot use dotless version as this would break domain search
                        $regex: tools.escapeRegexStr(query),
                        $options: ''
                    }
                }) ||
                {};

            if (forward) {
                filter['targets.value'] = {
                    $regex: tools.escapeRegexStr(forward),
                    $options: ''
                };
            }

            let tagSeen = new Set();

            let requiredTags = (result.value.requiredTags || '')
                .split(',')
                .map(tag => tag.toLowerCase().trim())
                .filter(tag => {
                    if (tag && !tagSeen.has(tag)) {
                        tagSeen.add(tag);
                        return true;
                    }
                    return false;
                });

            let tags = (result.value.tags || '')
                .split(',')
                .map(tag => tag.toLowerCase().trim())
                .filter(tag => {
                    if (tag && !tagSeen.has(tag)) {
                        tagSeen.add(tag);
                        return true;
                    }
                    return false;
                });

            let tagsview = {};
            if (requiredTags.length) {
                tagsview.$all = requiredTags;
            }
            if (tags.length) {
                tagsview.$in = tags;
            }

            if (requiredTags.length || tags.length) {
                filter.tagsview = tagsview;
            }

            if (ownOnly) {
                filter.user = new ObjectId(req.user);
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

            if (result.value.metaData) {
                opts.fields.projection.metaData = true;
            }

            if (result.value.internalData) {
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
                        values.metaData = tools.formatMetaData(addressData.metaData);
                    }

                    if (addressData.internalData) {
                        values.internalData = tools.formatMetaData(addressData.internalData);
                    }

                    return permission.filter(values);
                })
            };

            res.json(response);
            return next();
        })
    );

    server.post(
        '/users/:user/addresses',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                address: [Joi.string().email({ tlds: false }).required(), Joi.string().regex(/^\w+@\*$/, 'special address')],
                name: Joi.string().empty('').trim().max(128),
                main: booleanSchema,
                allowWildcard: booleanSchema,
                tags: Joi.array().items(Joi.string().trim().max(128)),

                metaData: metaDataSchema.label('metaData'),
                internalData: metaDataSchema.label('internalData'),

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

            let user = new ObjectId(result.value.user);

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('addresses'));
            } else {
                req.validate(roles.can(req.role).createAny('addresses'));
            }

            let main = result.value.main;
            let name = result.value.name;
            let address = tools.normalizeAddress(result.value.address);

            if (address.indexOf('+') >= 0) {
                res.json({
                    error: 'Address can not contain +'
                });
                return next();
            }

            let wcpos = address.indexOf('*');

            if (wcpos >= 0) {
                if (!result.value.allowWildcard) {
                    res.json({
                        error: 'Address can not contain *'
                    });
                    return next();
                }

                // wildcard in the beginning of username
                if (address.charAt(0) === '*') {
                    let partial = address.substr(1);

                    try {
                        // only one wildcard allowed
                        if (partial.indexOf('*') >= 0) {
                            throw new Error('Invalid wildcard address');
                        }

                        // for validation we need a correct email
                        if (partial.charAt(0) === '@') {
                            partial = 'test' + partial;
                        }

                        // check if wildcard username is not too long
                        if (partial.substr(0, partial.indexOf('@')).length > consts.MAX_ALLOWED_WILDCARD_LENGTH) {
                            throw new Error('Invalid wildcard address');
                        }

                        // result neewds to be a valid email
                        if (!isemail.validate(partial)) {
                            throw new Error('Invalid wildcard address');
                        }
                    } catch (err) {
                        res.json({
                            error: 'Invalid wildcard address, use "*@domain" or "user@*"'
                        });
                        return next();
                    }
                }

                if (address.charAt(address.length - 1) === '*') {
                    let partial = address.substr(0, address.length - 1);

                    try {
                        // only one wildcard allowed
                        if (partial.indexOf('*') >= 0) {
                            throw new Error('Invalid wildcard address');
                        }

                        // for validation we need a correct email
                        partial += 'example.com';

                        if (!isemail.validate(partial)) {
                            throw new Error('Invalid wildcard address');
                        }
                    } catch (err) {
                        res.json({
                            error: 'Invalid wildcard address, use "*@domain" or "user@*"'
                        });
                        return next();
                    }
                }

                if (/[^@]\*|\*[^@]/.test(result.value) || wcpos !== address.lastIndexOf('*')) {
                    res.json({
                        error: 'Invalid wildcard address, use "*@domain" or "user@*"'
                    });
                    return next();
                }

                if (main) {
                    res.json({
                        error: 'Main address can not contain *'
                    });
                    return next();
                }
            }

            if (result.value.tags) {
                let tagSeen = new Set();
                let tags = result.value.tags
                    .map(tag => tag.trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag.toLowerCase())) {
                            tagSeen.add(tag.toLowerCase());
                            return true;
                        }
                        return false;
                    })
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

                result.value.tags = tags;
                result.value.tagsview = tags.map(tag => tag.toLowerCase());
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    addrview: tools.uview(address)
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (addressData) {
                res.status(400);
                res.json({
                    error: 'This email address already exists',
                    code: 'AddressExistsError'
                });
                return next();
            }

            addressData = {
                user,
                name,
                address,
                addrview: tools.uview(address),
                created: new Date()
            };

            if (result.value.tags) {
                addressData.tags = result.value.tags;
                addressData.tagsview = result.value.tags;
            }

            if (result.value.metaData) {
                addressData.metaData = result.value.metaData;
            }

            if (result.value.internalData) {
                addressData.internalData = result.value.internalData;
            }

            let r;
            // insert alias address to email address registry
            try {
                r = await db.users.collection('addresses').insertOne(addressData);
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            let insertId = r.insertedId;

            if (!userData.address || main) {
                // register this address as the default address for that user
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

            res.json({
                success: !!insertId,
                id: insertId
            });
            return next();
        })
    );

    server.get(
        '/users/:user/addresses',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                metaData: booleanSchema,
                internalData: booleanSchema,
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

            let user = new ObjectId(result.value.user);

            // permissions check
            let permission;
            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).readOwn('addresses');
            } else {
                permission = roles.can(req.role).readAny('addresses');
            }

            // permissions check
            req.validate(permission);

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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!addresses) {
                addresses = [];
            }

            res.json({
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

                    if (result.value.metaData && addressData.metaData) {
                        values.metaData = tools.formatMetaData(addressData.metaData);
                    }

                    if (result.value.internalData && addressData.internalData) {
                        values.internalData = tools.formatMetaData(addressData.internalData);
                    }

                    return permission.filter(values);
                })
            });

            return next();
        })
    );

    server.get(
        '/users/:user/addresses/:address',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                address: Joi.string().hex().lowercase().length(24).required(),
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

            let user = new ObjectId(result.value.user);

            // permissions check
            let permission;
            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).readOwn('addresses');
            } else {
                permission = roles.can(req.role).readAny('addresses');
            }
            req.validate(permission);

            let address = new ObjectId(result.value.address);

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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: address,
                    user
                });
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
                value.metaData = tools.formatMetaData(addressData.metaData);
            }

            if (addressData.internalData) {
                value.internalData = tools.formatMetaData(addressData.internalData);
            }

            res.json(permission.filter(value));

            return next();
        })
    );

    server.put(
        '/users/:user/addresses/:id',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                id: Joi.string().hex().lowercase().length(24).required(),
                name: Joi.string().empty('').trim().max(128),
                address: Joi.string().email({ tlds: false }),
                main: booleanSchema,
                tags: Joi.array().items(Joi.string().trim().max(128)),

                metaData: metaDataSchema.label('metaData'),
                internalData: metaDataSchema.label('internalData'),

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

            let user = new ObjectId(result.value.user);

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('addresses'));
            } else {
                req.validate(roles.can(req.role).updateAny('addresses'));
            }

            let id = new ObjectId(result.value.id);
            let main = result.value.main;

            if (main === false) {
                res.json({
                    error: 'Cannot unset main status'
                });
                return next();
            }

            let updates = {};

            if (result.value.address) {
                let address = tools.normalizeAddress(result.value.address);
                let addrview = tools.uview(address);

                updates.address = address;
                updates.addrview = addrview;
            }

            if (result.value.name) {
                updates.name = result.value.name;
            }

            if (result.value.tags) {
                let tagSeen = new Set();
                let tags = result.value.tags
                    .map(tag => tag.trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag.toLowerCase())) {
                            tagSeen.add(tag.toLowerCase());
                            return true;
                        }
                        return false;
                    })
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

                updates.tags = tags;
                updates.tagsview = tags.map(tag => tag.toLowerCase());
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: id
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!addressData || !addressData.user || addressData.user.toString() !== user.toString()) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown email address identifier',
                    code: 'AddressNotFound'
                });
                return next();
            }

            if (addressData.address.indexOf('*') >= 0 && result.value.address && result.value.address !== addressData.address) {
                res.status(400);
                res.json({
                    error: 'Can not change special address',
                    code: 'ChangeNotAllowed'
                });
                return next();
            }

            if (result.value.address && result.value.address.indexOf('*') >= 0 && result.value.address !== addressData.address) {
                res.status(400);
                res.json({
                    error: 'Can not change special address',
                    code: 'ChangeNotAllowed'
                });
                return next();
            }

            if ((result.value.address || addressData.address).indexOf('*') >= 0 && main) {
                res.status(400);
                res.json({
                    error: 'Can not set wildcard address as default',
                    code: 'WildcardNotPermitted'
                });
                return next();
            }

            if (result.value.address && addressData.address === userData.address && result.value.address !== addressData.address) {
                // main address was changed, update user data as well
                main = true;
                addressData.address = result.value.address;
            }

            for (let key of ['metaData', 'internalData']) {
                if (result.value[key]) {
                    updates[key] = result.value[key];
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
                        res.status(400);
                        res.json({
                            error: 'Address already exists',
                            code: 'AddressExistsError'
                        });
                    } else {
                        res.status(500);
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            code: 'InternalDatabaseError'
                        });
                    }
                    return next();
                }
            }

            if (!main) {
                // nothing to do anymore
                res.json({
                    success: true
                });
                return next();
            }

            let r;
            try {
                r = await db.users.collection('users').updateOne(
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: !!r.matchedCount
            });
            return next();
        })
    );

    server.del(
        '/users/:user/addresses/:address',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                address: Joi.string().hex().lowercase().length(24).required(),
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

            let user = new ObjectId(result.value.user);

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('addresses'));
            } else {
                req.validate(roles.can(req.role).deleteAny('addresses'));
            }

            let address = new ObjectId(result.value.address);

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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

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

            if (!addressData || addressData.user.toString() !== user.toString()) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown email address identifier',
                    code: 'AddressNotFound'
                });
                return next();
            }

            if (addressData.address === userData.address) {
                res.json({
                    error: 'Trying to delete main address. Set a new main address first'
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
                    ev: ADDRESS_USER_DELETED,
                    user,
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
        '/users/:user/addressregister',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                query: Joi.string().trim().empty('').max(255).required(),
                limit: Joi.number().default(20).min(1).max(250),
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

            let user = new ObjectId(result.value.user);

            // permissions check
            let permission;
            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).readOwn('addresses');
            } else {
                permission = roles.can(req.role).readAny('addresses');
            }

            // permissions check
            req.validate(permission);

            let query = result.value.query;
            let limit = result.value.limit;

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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let addresses;
            try {
                addresses = await db.database
                    .collection('addressregister')
                    .find(
                        {
                            user,
                            $or: [
                                {
                                    address: {
                                        // cannot use dotless version as this would break domain search
                                        $regex: '^' + tools.escapeRegexStr(query),
                                        $options: ''
                                    }
                                },
                                {
                                    name: {
                                        // cannot use dotless version as this would break domain search
                                        $regex: '^' + tools.escapeRegexStr(query),
                                        $options: 'i'
                                    }
                                }
                            ]
                        },
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!addresses) {
                addresses = [];
            }

            res.json({
                success: true,

                results: addresses.map(addressData => {
                    let name = addressData.name || false;
                    try {
                        // try to decode
                        if (name) {
                            name = libmime.decodeWords(name);
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
            });

            return next();
        })
    );

    server.post(
        '/addresses/forwarded',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                address: Joi.alternatives()
                    .try(Joi.string().email({ tlds: false }).required(), Joi.string().regex(/^\w+@\*$/, 'special address'))
                    .required(),
                name: Joi.string().empty('').trim().max(128),
                targets: Joi.array().items(
                    Joi.string().email({ tlds: false }),
                    Joi.string().uri({
                        scheme: [/smtps?/, /https?/],
                        allowRelative: false,
                        relativeOnly: false
                    })
                ),
                forwards: Joi.number().min(0).default(0),
                allowWildcard: booleanSchema,
                autoreply: Joi.object().keys({
                    status: booleanSchema.default(true),
                    start: Joi.date().empty('').allow(false),
                    end: Joi.date().empty('').allow(false),
                    name: Joi.string().empty('').trim().max(128),
                    subject: Joi.string().empty('').trim().max(128),
                    text: Joi.string()
                        .empty('')
                        .trim()
                        .max(128 * 1024),
                    html: Joi.string()
                        .empty('')
                        .trim()
                        .max(128 * 1024)
                }),
                tags: Joi.array().items(Joi.string().trim().max(128)),
                metaData: metaDataSchema.label('metaData'),
                internalData: metaDataSchema.label('internalData'),
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
            req.validate(roles.can(req.role).createAny('addresses'));

            let address = tools.normalizeAddress(result.value.address);
            let addrview = tools.uview(address);
            let name = result.value.name;

            let targets = result.value.targets || [];
            let forwards = result.value.forwards;

            if (result.value.autoreply) {
                if (!result.value.autoreply.name && 'name' in req.params.autoreply) {
                    result.value.autoreply.name = '';
                }

                if (!result.value.autoreply.subject && 'subject' in req.params.autoreply) {
                    result.value.autoreply.subject = '';
                }

                if (!result.value.autoreply.text && 'text' in req.params.autoreply) {
                    result.value.autoreply.text = '';
                    if (!result.value.autoreply.html) {
                        // make sure we also update html part
                        result.value.autoreply.html = '';
                    }
                }

                if (!result.value.autoreply.html && 'html' in req.params.autoreply) {
                    result.value.autoreply.html = '';
                    if (!result.value.autoreply.text) {
                        // make sure we also update plaintext part
                        result.value.autoreply.text = '';
                    }
                }
            } else {
                result.value.autoreply = {
                    status: false
                };
            }

            if (result.value.tags) {
                let tagSeen = new Set();
                let tags = result.value.tags
                    .map(tag => tag.trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag.toLowerCase())) {
                            tagSeen.add(tag.toLowerCase());
                            return true;
                        }
                        return false;
                    })
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

                result.value.tags = tags;
                result.value.tagsview = tags.map(tag => tag.toLowerCase());
            }

            // needed to resolve users for addresses
            let addrlist = [];
            let cachedAddrviews = new WeakMap();

            for (let i = 0, len = targets.length; i < len; i++) {
                let target = targets[i];
                if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                    // email
                    let addr = tools.normalizeAddress(target);
                    let addrv = addr.substr(0, addr.indexOf('@')).replace(/\./g, '') + addr.substr(addr.indexOf('@'));
                    if (addrv === addrview) {
                        res.status(400);
                        res.json({
                            error: 'Can not forward to self "' + target + '"',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                    targets[i] = {
                        id: new ObjectId(),
                        type: 'mail',
                        value: target
                    };
                    cachedAddrviews.set(targets[i], addrv);
                    addrlist.push(addrv);
                } else if (/^smtps?:/i.test(target)) {
                    targets[i] = {
                        id: new ObjectId(),
                        type: 'relay',
                        value: target
                    };
                } else if (/^https?:/i.test(target)) {
                    targets[i] = {
                        id: new ObjectId(),
                        type: 'http',
                        value: target
                    };
                } else {
                    res.status(400);
                    res.json({
                        error: 'Unknown target type "' + target + '"',
                        code: 'InputValidationError'
                    });
                    return next();
                }
            }

            if (address.indexOf('+') >= 0) {
                res.json({
                    error: 'Address can not contain +'
                });
                return next();
            }

            let wcpos = address.indexOf('*');

            if (wcpos >= 0) {
                if (!result.value.allowWildcard) {
                    res.json({
                        error: 'Address can not contain *'
                    });
                    return next();
                }

                if (/[^@]\*|\*[^@]/.test(result.value) || wcpos !== address.lastIndexOf('*')) {
                    res.json({
                        error: 'Invalid wildcard address, use "*@domain" or "user@*"'
                    });
                    return next();
                }
            }

            let addressData;
            try {
                addressData = await db.users.collection('addresses').findOne({
                    addrview
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (addressData) {
                res.status(400);
                res.json({
                    error: 'This email address already exists',
                    code: 'AddressExistsError'
                });
                return next();
            }

            if (addrlist.length) {
                let addressList;
                try {
                    addressList = await db.users
                        .collection('addresses')
                        .find({
                            addrview: { $in: addrlist }
                        })
                        .toArray();
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                let map = new Map(addressList.filter(addr => addr.user).map(addr => [addr.addrview, addr.user]));
                targets.forEach(target => {
                    let addrv = cachedAddrviews.get(target);
                    if (addrv && map.has(addrv)) {
                        target.user = map.get(addrv);
                    }
                });
            }

            // insert alias address to email address registry
            addressData = {
                name,
                address,
                addrview: tools.uview(address),
                targets,
                forwards,
                autoreply: result.value.autoreply,
                created: new Date()
            };

            if (result.value.tags) {
                addressData.tags = result.value.tags;
                addressData.tagsview = result.value.tags;
            }

            if (result.value.metaData) {
                addressData.metaData = result.value.metaData;
            }

            if (result.value.internalData) {
                addressData.internalData = result.value.internalData;
            }

            let r;

            try {
                r = await db.users.collection('addresses').insertOne(addressData);
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
                ev: ADDRESS_FORWARDED_CREATED,
                address: insertId,
                value: addressData.address
            });

            res.json({
                success: !!insertId,
                id: insertId
            });
            return next();
        })
    );

    server.put(
        '/addresses/forwarded/:id',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                id: Joi.string().hex().lowercase().length(24).required(),
                address: Joi.string().email({ tlds: false }),
                name: Joi.string().empty('').trim().max(128),
                targets: Joi.array().items(
                    Joi.string().email({ tlds: false }),
                    Joi.string().uri({
                        scheme: [/smtps?/, /https?/],
                        allowRelative: false,
                        relativeOnly: false
                    })
                ),
                forwards: Joi.number().min(0),
                autoreply: Joi.object().keys({
                    status: booleanSchema,
                    start: Joi.date().empty('').allow(false),
                    end: Joi.date().empty('').allow(false),
                    name: Joi.string().empty('').trim().max(128),
                    subject: Joi.string().empty('').trim().max(128),
                    text: Joi.string()
                        .empty('')
                        .trim()
                        .max(128 * 1024),
                    html: Joi.string()
                        .empty('')
                        .trim()
                        .max(128 * 1024)
                }),
                tags: Joi.array().items(Joi.string().trim().max(128)),
                metaData: metaDataSchema.label('metaData'),
                internalData: metaDataSchema.label('internalData'),
                forwardedDisabled: booleanSchema,
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
            req.validate(roles.can(req.role).updateAny('addresses'));

            let id = new ObjectId(result.value.id);
            let updates = {};
            if (result.value.address) {
                let address = tools.normalizeAddress(result.value.address);
                let addrview = tools.uview(address);

                updates.address = address;
                updates.addrview = addrview;
            }

            if (result.value.forwards) {
                updates.forwards = result.value.forwards;
            }

            if (result.value.name) {
                updates.name = result.value.name;
            }

            if (result.value.forwardedDisabled !== undefined) {
                updates.forwardedDisabled = result.value.forwardedDisabled;
            }

            if (result.value.autoreply) {
                if (!result.value.autoreply.name && 'name' in req.params.autoreply) {
                    result.value.autoreply.name = '';
                }

                if (!result.value.autoreply.subject && 'subject' in req.params.autoreply) {
                    result.value.autoreply.subject = '';
                }

                if (!result.value.autoreply.text && 'text' in req.params.autoreply) {
                    result.value.autoreply.text = '';
                    if (!result.value.autoreply.html) {
                        // make sure we also update html part
                        result.value.autoreply.html = '';
                    }
                }

                if (!result.value.autoreply.html && 'html' in req.params.autoreply) {
                    result.value.autoreply.html = '';
                    if (!result.value.autoreply.text) {
                        // make sure we also update plaintext part
                        result.value.autoreply.text = '';
                    }
                }

                Object.keys(result.value.autoreply).forEach(key => {
                    updates['autoreply.' + key] = result.value.autoreply[key];
                });
            }

            if (result.value.tags) {
                let tagSeen = new Set();
                let tags = result.value.tags
                    .map(tag => tag.trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag.toLowerCase())) {
                            tagSeen.add(tag.toLowerCase());
                            return true;
                        }
                        return false;
                    })
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

                updates.tags = tags;
                updates.tagsview = tags.map(tag => tag.toLowerCase());
            }

            if (result.value.metaData) {
                updates.metaData = result.value.metaData;
            }

            if (result.value.internalData) {
                updates.internalData = result.value.internalData;
            }

            let addressData;

            try {
                addressData = await db.users.collection('addresses').findOne({
                    _id: id
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

            if (addressData.address.indexOf('*') >= 0 && result.value.address && result.value.address !== addressData.address) {
                res.status(400);
                res.json({
                    error: 'Can not change special address',
                    code: 'ChangeNotAllowed'
                });
                return next();
            }

            if (result.value.address && result.value.address.indexOf('*') >= 0 && result.value.address !== addressData.address) {
                res.status(400);
                res.json({
                    error: 'Can not change special address',
                    code: 'ChangeNotAllowed'
                });
                return next();
            }

            let targets = result.value.targets;
            let addrlist = [];
            let cachedAddrviews = new WeakMap();

            if (targets) {
                // needed to resolve users for addresses

                for (let i = 0, len = targets.length; i < len; i++) {
                    let target = targets[i];
                    if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                        // email
                        let addr = tools.normalizeAddress(target);
                        let addrv = addr.substr(0, addr.indexOf('@')).replace(/\./g, '') + addr.substr(addr.indexOf('@'));
                        if (addrv === addressData.addrview) {
                            res.status(400);
                            res.json({
                                error: 'Can not forward to self "' + target + '"',
                                code: 'InputValidationError'
                            });
                            return next();
                        }
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'mail',
                            value: target
                        };
                        cachedAddrviews.set(targets[i], addrv);
                        addrlist.push(addrv);
                    } else if (/^smtps?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'relay',
                            value: target
                        };
                    } else if (/^https?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'http',
                            value: target
                        };
                    } else {
                        res.status(400);
                        res.json({
                            error: 'Unknown target type "' + target + '"',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                }

                updates.targets = targets;
            }

            if (targets && addrlist.length) {
                let addressList;
                try {
                    addressList = await db.users
                        .collection('addresses')
                        .find({
                            addrview: { $in: addrlist }
                        })
                        .toArray();
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                let map = new Map(addressList.filter(addr => addr.user).map(addr => [addr.addrview, addr.user]));
                targets.forEach(target => {
                    let addrv = cachedAddrviews.get(target);
                    if (addrv && map.has(addrv)) {
                        target.user = map.get(addrv);
                    }
                });
            }

            // insert alias address to email address registry
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
                    res.status(400);
                    res.json({
                        error: 'Address already exists',
                        code: 'AddressExistsError'
                    });
                } else {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                }
                return next();
            }

            res.json({
                success: !!r.matchedCount
            });
            return next();
        })
    );

    server.del(
        '/addresses/forwarded/:address',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                address: Joi.string().hex().lowercase().length(24).required(),
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
                address: Joi.string().hex().lowercase().length(24).required(),
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
                allowWildcard: booleanSchema,
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
                newDomain: Joi.string().required(),
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
};
