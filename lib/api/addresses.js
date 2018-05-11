'use strict';

const config = require('wild-config');
const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination-node6');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const consts = require('../consts');

module.exports = (db, server) => {
    /**
     * @api {get} /addresses List registered Addresses
     * @apiName GetAddresses
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} [query] Partial match of an address
     * @apiParam {String} [tags] Comma separated list of tags. The Address must have at least one to be set
     * @apiParam {String} [requiredTags] Comma separated list of tags. The Address must have all listed tags to be set
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
     * @apiSuccess {Object[]} results Address listing
     * @apiSuccess {String} results.id ID of the Address
     * @apiSuccess {String} results.name Identity name
     * @apiSuccess {String} results.address E-mail address string
     * @apiSuccess {String} results.user User ID this address belongs to if this is an User address
     * @apiSuccess {Boolean} results.forwarded If true then it is a forwarded address
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/addresses
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
     *           "address": "user@example.com",
     *           "user": "59ef21aef255ed1d9d790e7a"
     *         },
     *         {
     *           "id": "59ef21aef255ed1d9d790e81",
     *           "address": "user@example.com",
     *           "forwarded": true
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
    server.get({ name: 'addresses', path: '/addresses' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            query: Joi.string()
                .trim()
                .empty('')
                .max(255),
            tags: Joi.string()
                .trim()
                .empty('')
                .max(1024),
            requiredTags: Joi.string()
                .trim()
                .empty('')
                .max(1024),
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let query = result.value.query;
        let limit = result.value.limit;
        let page = result.value.page;
        let pageNext = result.value.next;
        let pagePrevious = result.value.previous;

        let filter =
            (query && {
                address: {
                    // cannot use dotless version as this would break domain search
                    $regex: query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                    $options: ''
                }
            }) ||
            {};

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

        db.users.collection('addresses').count(filter, (err, total) => {
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
                    address: true,
                    name: true,
                    user: true,
                    tags: true,
                    targets: true
                },
                paginatedField: 'addrview',
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrevious) {
                opts.previous = pagePrevious;
            }

            MongoPaging.find(db.users.collection('addresses'), opts, (err, result) => {
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
                    results: (result.results || []).map(addressData => ({
                        id: addressData._id.toString(),
                        name: addressData.name || false,
                        address: addressData.address,
                        user: addressData.user,
                        forwarded: addressData.targets && true,
                        tags: addressData.tags || []
                    }))
                };

                res.json(response);
                return next();
            });
        });
    });

    /**
     * @api {post} /users/:user/addresses Create new Address
     * @apiName PostUserAddress
     * @apiGroup Addresses
     * @apiDescription Add a new email address for an User. Addresses can contain unicode characters.
     * Dots in usernames are normalized so no need to create both "firstlast@example.com" and "first.last@example.com"
     *
     * Special addresses <code>\*@example.com</code> and <code>username@\*</code> catches all emails to these domains or users without a registered destination (requires <code>allowWildcard</code> argument)
     *
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} address E-mail Address
     * @apiParam {String} [name] Identity name
     * @apiParam {String[]} [tags] A list of tags associated with this address
     * @apiParam {Boolean} [main=false] Indicates if this is the default address for the User
     * @apiParam {Boolean} [allowWildcard=false] If <code>true</code> then address value can be in the form of <code>*@example.com</code>, otherwise using * is not allowed
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Address
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/addresses \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "address": "my.new.address@example.com"
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
    server.post('/users/:user/addresses', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            address: [
                Joi.string()
                    .email()
                    .required(),
                Joi.string().regex(/^\w+@\*$/, 'special address')
            ],
            name: Joi.string()
                .empty('')
                .trim()
                .max(128),
            main: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, '']),
            allowWildcard: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, '']),
            tags: Joi.array().items(
                Joi.string()
                    .trim()
                    .max(128)
            )
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
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

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                if (!userData) {
                    res.json({
                        error: 'This user does not exist',
                        code: 'UserNotFound'
                    });
                    return next();
                }

                db.users.collection('addresses').findOne(
                    {
                        addrview: tools.uview(address)
                    },
                    (err, addressData) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                code: 'InternalDatabaseError'
                            });
                            return next();
                        }

                        if (addressData) {
                            res.json({
                                error: 'This email address already exists',
                                code: 'AddressExists'
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

                        // insert alias address to email address registry
                        db.users.collection('addresses').insertOne(addressData, (err, r) => {
                            if (err) {
                                res.json({
                                    error: 'MongoDB Error: ' + err.message,
                                    code: 'InternalDatabaseError'
                                });
                                return next();
                            }

                            let insertId = r.insertedId;

                            let done = () => {
                                // ignore potential user update error
                                res.json({
                                    success: !!insertId,
                                    id: insertId
                                });
                                return next();
                            };

                            if (!userData.address || main) {
                                // register this address as the default address for that user
                                return db.users.collection('users').findOneAndUpdate(
                                    {
                                        _id: user
                                    },
                                    {
                                        $set: {
                                            address
                                        }
                                    },
                                    {},
                                    done
                                );
                            }

                            done();
                        });
                    }
                );
            }
        );
    });

    /**
     * @api {get} /users/:user/addresses List registered Addresses for an User
     * @apiName GetUserAddresses
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} results Address listing
     * @apiSuccess {String} results.id ID of the Address
     * @apiSuccess {String} results.name Identity name
     * @apiSuccess {String} results.address E-mail address string
     * @apiSuccess {Boolean} results.main Indicates if this is the default address for the User
     * @apiSuccess {String} results.created Datestring of the time the address was created
     * @apiSuccess {String[]} results.tags List of tags associated with the Address
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59ef21aef255ed1d9d790e7a/addresses
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
     *           "address": "user@example.com",
     *           "main": true,
     *           "created": "2017-10-24T11:19:10.911Z"
     *         }
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.get('/users/:user/addresses', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    name: true,
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                if (!userData) {
                    res.json({
                        error: 'This user does not exist',
                        code: 'UserNotFound'
                    });
                    return next();
                }

                db.users
                    .collection('addresses')
                    .find({
                        user
                    })
                    .sort({
                        addrview: 1
                    })
                    .toArray((err, addresses) => {
                        if (err) {
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

                            results: addresses.map(address => ({
                                id: address._id,
                                name: address.name || false,
                                address: address.address,
                                main: address.address === userData.address,
                                tags: address.tags || [],
                                created: address.created
                            }))
                        });

                        return next();
                    });
            }
        );
    });

    /**
     * @api {get} /users/:user/addresses/:address Request Addresses information
     * @apiName GetUserAddress
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} address ID of the Address
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Address
     * @apiSuccess {String} name Identity name
     * @apiSuccess {String} address E-mail address string
     * @apiSuccess {Boolean} main Indicates if this is the default address for the User
     * @apiSuccess {String} created Datestring of the time the address was created
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59ef21aef255ed1d9d790e7a/addresses/59ef21aef255ed1d9d790e81
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e81",
     *       "address": "user@example.com",
     *       "main": true,
     *       "created": "2017-10-24T11:19:10.911Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.get('/users/:user/addresses/:address', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            address: Joi.string()
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let address = new ObjectID(result.value.address);

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    name: true,
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                if (!userData) {
                    res.json({
                        error: 'This user does not exist',
                        code: 'UserNotFound'
                    });
                    return next();
                }

                db.users.collection('addresses').findOne(
                    {
                        _id: address,
                        user
                    },
                    (err, addressData) => {
                        if (err) {
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

                        res.json({
                            success: true,
                            id: addressData._id,
                            name: addressData.name || false,
                            address: addressData.address,
                            main: addressData.address === userData.address,
                            created: addressData.created
                        });

                        return next();
                    }
                );
            }
        );
    });

    /**
     * @api {put} /users/:user/addresses/:address Update Address information
     * @apiName PutUserAddress
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} id ID of the Address
     * @apiParam {String} [name] Identity name
     * @apiParam {String} [address] New address if you want to rename existing address. Only affects normal addresses, special addresses that include \* can not be changed
     * @apiParam {Boolean} main Indicates if this is the default address for the User

     * @apiParam {String[]} [tags] A list of tags associated with this address
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/addresses/5a1d4541153888cdcd62a71b \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "main": true
     *     }'
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
     *       "error": "This user does not exist"
     *     }
     */
    server.put('/users/:user/addresses/:id', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            id: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            name: Joi.string()
                .empty('')
                .trim()
                .max(128),
            address: Joi.string().email(),
            main: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, '']),
            tags: Joi.array().items(
                Joi.string()
                    .trim()
                    .max(128)
            )
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let id = new ObjectID(result.value.id);
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

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                if (!userData) {
                    res.json({
                        error: 'This user does not exist',
                        code: 'UserNotFound'
                    });
                    return next();
                }

                db.users.collection('addresses').findOne(
                    {
                        _id: id
                    },
                    (err, addressData) => {
                        if (err) {
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
                            res.json({
                                error: 'Can not change special address',
                                code: 'ChangeNotAllowed'
                            });
                            return next();
                        }

                        if (result.value.address && result.value.address.indexOf('*') >= 0 && result.value.address !== addressData.address) {
                            res.json({
                                error: 'Can not change special address',
                                code: 'ChangeNotAllowed'
                            });
                            return next();
                        }

                        if ((result.value.address || addressData.address).indexOf('*') >= 0 && main) {
                            res.json({
                                error: 'Can not set wildcard address as default'
                            });
                            return next();
                        }

                        if (result.value.address && addressData.address === userData.address && result.value.address !== addressData.address) {
                            // main address was changed, update user data as well
                            main = true;
                            addressData.address = result.value.address;
                        }

                        let updateAddressData = done => {
                            if (!Object.keys(updates).length) {
                                return done();
                            }
                            db.users.collection('addresses').findOneAndUpdate(
                                {
                                    _id: addressData._id
                                },
                                {
                                    $set: updates
                                },
                                {
                                    returnOriginal: false
                                },
                                err => {
                                    if (err) {
                                        if (err.code === 11000) {
                                            res.json({
                                                error: 'Address already exists',
                                                code: 'AddressExistsError'
                                            });
                                        } else {
                                            res.json({
                                                error: 'MongoDB Error: ' + err.message,
                                                code: 'InternalDatabaseError'
                                            });
                                        }
                                        return next();
                                    }
                                    return done();
                                }
                            );
                        };

                        updateAddressData(() => {
                            if (!main) {
                                // nothing to do anymore
                                res.json({
                                    success: true
                                });
                                return next();
                            }

                            db.users.collection('users').findOneAndUpdate(
                                {
                                    _id: user
                                },
                                {
                                    $set: {
                                        address: addressData.address
                                    }
                                },
                                {
                                    returnOriginal: false
                                },
                                (err, r) => {
                                    if (err) {
                                        res.json({
                                            error: 'MongoDB Error: ' + err.message,
                                            code: 'InternalDatabaseError'
                                        });
                                        return next();
                                    }

                                    res.json({
                                        success: !!r.value
                                    });
                                    return next();
                                }
                            );
                        });
                    }
                );
            }
        );
    });

    /**
     * @api {delete} /users/:user/addresses/:address Delete an Address
     * @apiName DeleteUserAddress
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} address ID of the Address
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/59ef21aef255ed1d9d790e7a/addresses/59ef21aef255ed1d9d790e81
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
     *       "error": "Trying to delete main address. Set a new main address first"
     *     }
     */
    server.del('/users/:user/addresses/:address', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            address: Joi.string()
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let address = new ObjectID(result.value.address);

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                if (!userData) {
                    res.json({
                        error: 'This user does not exist',
                        code: 'UserNotFound'
                    });
                    return next();
                }

                db.users.collection('addresses').findOne(
                    {
                        _id: address
                    },
                    (err, addressData) => {
                        if (err) {
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
                        db.users.collection('addresses').deleteOne(
                            {
                                _id: address
                            },
                            (err, r) => {
                                if (err) {
                                    res.json({
                                        error: 'MongoDB Error: ' + err.message,
                                        code: 'InternalDatabaseError'
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
            }
        );
    });

    /**
     * @api {post} /addresses/forwarded Create new forwarded Address
     * @apiName PostForwardedAddress
     * @apiGroup Addresses
     * @apiDescription Add a new forwarded email address. Addresses can contain unicode characters.
     * Dots in usernames are normalized so no need to create both "firstlast@example.com" and "first.last@example.com"
     *
     * Special addresses <code>\*@example.com</code> and <code>username@\*</code> catches all emails to these domains or users without a registered destination (requires <code>allowWildcard</code> argument)
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} address E-mail Address
     * @apiParam {String} [name] Identity name
     * @apiParam {String[]} [targets] An array of forwarding targets. The value could either be an email address or a relay url to next MX server ("smtp://mx2.zone.eu:25") or an URL where mail contents are POSTed to
     * @apiParam {Number} [forwards] Daily allowed forwarding count for this address
     * @apiParam {Boolean} [allowWildcard=false] If <code>true</code> then address value can be in the form of <code>*@example.com</code>, otherwise using * is not allowed
     * @apiParam {String[]} [tags] A list of tags associated with this address
     * @apiParam {Object} [autoreply] Autoreply information
     * @apiParam {Boolean} [autoreply.status] If true, then autoreply is enabled for this address
     * @apiParam {String} [autoreply.start] Either a date string or boolean false to disable start time checks
     * @apiParam {String} [autoreply.end] Either a date string or boolean false to disable end time checks
     * @apiParam {String} [autoreply.name] Name that is used for the From: header in autoreply message
     * @apiParam {String} [autoreply.subject] Autoreply subject line
     * @apiParam {String} [autoreply.text] Autoreply plaintext content
     * @apiParam {String} [autoreply.html] Autoreply HTML content
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Address
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/addresses/forwarded \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "address": "my.new.address@example.com",
     *       "targets": [
     *           "my.old.address@example.com",
     *           "smtp://mx2.zone.eu:25"
     *       ],
     *       "forwards": 500
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
     *       "error": "This email address already exists"
     *     }
     */
    server.post('/addresses/forwarded', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            address: [
                Joi.string()
                    .email()
                    .required(),
                Joi.string().regex(/^\w+@\*$/, 'special address')
            ],
            name: Joi.string()
                .empty('')
                .trim()
                .max(128),
            targets: Joi.array().items(
                Joi.string().email(),
                Joi.string().uri({
                    scheme: [/smtps?/, /https?/],
                    allowRelative: false,
                    relativeOnly: false
                })
            ),
            forwards: Joi.number()
                .min(0)
                .default(0),
            allowWildcard: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, '']),
            autoreply: Joi.object().keys({
                status: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', 1])
                    .falsy(['N', 'false', 'no', 'off', 0, ''])
                    .default(true),
                start: Joi.date()
                    .empty('')
                    .allow(false),
                end: Joi.date()
                    .empty('')
                    .allow(false),
                name: Joi.string()
                    .empty('')
                    .trim()
                    .max(128),
                subject: Joi.string()
                    .empty('')
                    .trim()
                    .max(128),
                text: Joi.string()
                    .empty('')
                    .trim()
                    .max(128 * 1024),
                html: Joi.string()
                    .empty('')
                    .trim()
                    .max(128 * 1024)
            }),
            tags: Joi.array().items(
                Joi.string()
                    .trim()
                    .max(128)
            )
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

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
                    res.json({
                        error: 'Can not forward to self "' + target + '"',
                        code: 'InputValidationError'
                    });
                    return next();
                }
                targets[i] = {
                    id: new ObjectID(),
                    type: 'mail',
                    value: target
                };
                cachedAddrviews.set(targets[i], addrv);
                addrlist.push(addrv);
            } else if (/^smtps?:/i.test(target)) {
                targets[i] = {
                    id: new ObjectID(),
                    type: 'relay',
                    value: target
                };
            } else if (/^https?:/i.test(target)) {
                targets[i] = {
                    id: new ObjectID(),
                    type: 'http',
                    value: target
                };
            } else {
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

        let resolveUsers = done => {
            if (!addrlist.length) {
                return done();
            }
            db.users
                .collection('addresses')
                .find({
                    addrview: { $in: addrlist }
                })
                .toArray((err, addressList) => {
                    if (err) {
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
                    done();
                });
        };

        db.users.collection('addresses').findOne(
            {
                addrview
            },
            (err, addressData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (addressData) {
                    res.json({
                        error: 'This email address already exists',
                        code: 'AddressExists'
                    });
                    return next();
                }

                resolveUsers(() => {
                    // insert alias address to email address registry

                    let addressData = {
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

                    db.users.collection('addresses').insertOne(addressData, (err, r) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                code: 'InternalDatabaseError'
                            });
                            return next();
                        }

                        let insertId = r.insertedId;

                        res.json({
                            success: !!insertId,
                            id: insertId
                        });
                        return next();
                    });
                });
            }
        );
    });

    /**
     * @api {put} /addresses/forwarded/:address Update forwarded Address information
     * @apiName PutForwardedAddress
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id ID of the Address
     * @apiParam {String} [address] New address. Only affects normal addresses, special addresses that include \* can not be changed
     * @apiParam {String} [name] Identity name
     * @apiParam {String[]} [targets] An array of forwarding targets. The value could either be an email address or a relay url to next MX server ("smtp://mx2.zone.eu:25") or an URL where mail contents are POSTed to. If set then overwrites previous targets array
     * @apiParam {Number} [forwards] Daily allowed forwarding count for this address
     * @apiParam {String[]} [tags] A list of tags associated with this address
     * @apiParam {Object} [autoreply] Autoreply information
     * @apiParam {Boolean} [autoreply.status] If true, then autoreply is enabled for this address
     * @apiParam {String} [autoreply.start] Either a date string or boolean false to disable start time checks
     * @apiParam {String} [autoreply.end] Either a date string or boolean false to disable end time checks
     * @apiParam {String} [autoreply.name] Name that is used for the From: header in autoreply message
     * @apiParam {String} [autoreply.subject] Autoreply subject line
     * @apiParam {String} [autoreply.text] Autoreply plaintext content
     * @apiParam {String} [autoreply.html] Autoreply HTML content
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/addresses/forwarded/5a1d4541153888cdcd62a71b \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "targets": [
     *         "some.other.address@example.com"
     *       ]
     *     }'
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
     *       "error": "This address does not exist"
     *     }
     */
    server.put('/addresses/forwarded/:id', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            id: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            address: Joi.string().email(),
            name: Joi.string()
                .empty('')
                .trim()
                .max(128),
            targets: Joi.array().items(
                Joi.string().email(),
                Joi.string().uri({
                    scheme: [/smtps?/, /https?/],
                    allowRelative: false,
                    relativeOnly: false
                })
            ),
            forwards: Joi.number().min(0),
            autoreply: Joi.object().keys({
                status: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', 1])
                    .falsy(['N', 'false', 'no', 'off', 0, '']),
                start: Joi.date()
                    .empty('')
                    .allow(false),
                end: Joi.date()
                    .empty('')
                    .allow(false),
                name: Joi.string()
                    .empty('')
                    .trim()
                    .max(128),
                subject: Joi.string()
                    .empty('')
                    .trim()
                    .max(128),
                text: Joi.string()
                    .empty('')
                    .trim()
                    .max(128 * 1024),
                html: Joi.string()
                    .empty('')
                    .trim()
                    .max(128 * 1024)
            }),
            tags: Joi.array().items(
                Joi.string()
                    .trim()
                    .max(128)
            )
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let id = new ObjectID(result.value.id);
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

        db.users.collection('addresses').findOne(
            {
                _id: id
            },
            (err, addressData) => {
                if (err) {
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
                    res.json({
                        error: 'Can not change special address',
                        code: 'ChangeNotAllowed'
                    });
                    return next();
                }

                if (result.value.address && result.value.address.indexOf('*') >= 0 && result.value.address !== addressData.address) {
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
                                res.json({
                                    error: 'Can not forward to self "' + target + '"',
                                    code: 'InputValidationError'
                                });
                                return next();
                            }
                            targets[i] = {
                                id: new ObjectID(),
                                type: 'mail',
                                value: target
                            };
                            cachedAddrviews.set(targets[i], addrv);
                            addrlist.push(addrv);
                        } else if (/^smtps?:/i.test(target)) {
                            targets[i] = {
                                id: new ObjectID(),
                                type: 'relay',
                                value: target
                            };
                        } else if (/^https?:/i.test(target)) {
                            targets[i] = {
                                id: new ObjectID(),
                                type: 'http',
                                value: target
                            };
                        } else {
                            res.json({
                                error: 'Unknown target type "' + target + '"',
                                code: 'InputValidationError'
                            });
                            return next();
                        }
                    }

                    updates.targets = targets;
                }

                let resolveUsers = done => {
                    if (!targets || !addrlist.length) {
                        return done();
                    }
                    db.users
                        .collection('addresses')
                        .find({
                            addrview: { $in: addrlist }
                        })
                        .toArray((err, addressList) => {
                            if (err) {
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
                            done();
                        });
                };

                resolveUsers(() => {
                    // insert alias address to email address registry
                    db.users.collection('addresses').findOneAndUpdate(
                        {
                            _id: addressData._id
                        },
                        {
                            $set: updates
                        },
                        {
                            returnOriginal: false
                        },
                        (err, r) => {
                            if (err) {
                                if (err.code === 11000) {
                                    res.json({
                                        error: 'Address already exists',
                                        code: 'AddressExistsError'
                                    });
                                } else {
                                    res.json({
                                        error: 'MongoDB Error: ' + err.message,
                                        code: 'InternalDatabaseError'
                                    });
                                }
                                return next();
                            }

                            res.json({
                                success: !!r.value
                            });
                            return next();
                        }
                    );
                });
            }
        );
    });

    /**
     * @api {delete} /addresses/forwarded/:address Delete a forwarded Address
     * @apiName DeleteForwardedAddress
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} address ID of the Address
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/addresses/forwarded/59ef21aef255ed1d9d790e81
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
     *       "error": "This address does not exist"
     *     }
     */
    server.del('/addresses/forwarded/:address', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            address: Joi.string()
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let address = new ObjectID(result.value.address);

        db.users.collection('addresses').findOne(
            {
                _id: address
            },
            (err, addressData) => {
                if (err) {
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
                db.users.collection('addresses').deleteOne(
                    {
                        _id: address
                    },
                    (err, r) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                code: 'InternalDatabaseError'
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

    /**
     * @api {get} /addresses/forwarded/:address Request forwarded Addresses information
     * @apiName GetForwardedAddress
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} address ID of the Address
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Address
     * @apiSuccess {String} address E-mail address string
     * @apiSuccess {String} name Identity name
     * @apiSuccess {String[]} targets List of forwarding targets
     * @apiSuccess {Object} limits Account limits and usage
     * @apiSuccess {Object} limits.forwards Forwarding quota
     * @apiSuccess {Number} limits.forwards.allowed How many messages per 24 hour can be forwarded
     * @apiSuccess {Number} limits.forwards.used  How many messages are forwarded during current 24 hour period
     * @apiSuccess {Number} limits.forwards.ttl Time until the end of current 24 hour period
     * @apiSuccess {Object} autoreply Autoreply information
     * @apiSuccess {Boolean} autoreply.status If true, then autoreply is enabled for this address
     * @apiSuccess {String} autoreply.name Name that is used for the From: header in autoreply message
     * @apiSuccess {String} autoreply.subject Autoreply subject line
     * @apiSuccess {String} autoreply.text Autoreply plaintext content
     * @apiSuccess {String} autoreply.html Autoreply HTML content
     * @apiSuccess {String} created Datestring of the time the address was created
     * @apiSuccess {String[]} results.tags List of tags associated with the Address
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/addresses/forwarded/59ef21aef255ed1d9d790e81
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e81",
     *       "address": "user@example.com",
     *       "targets": [
     *          "my.other.address@example.com"
     *       ],
     *       "limits": {
     *         "forwards": {
     *           "allowed": 2000,
     *           "used": 0,
     *           "ttl": false
     *         }
     *       },
     *       "created": "2017-10-24T11:19:10.911Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This address does not exist"
     *     }
     */
    server.get('/addresses/forwarded/:address', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            address: Joi.string()
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let address = new ObjectID(result.value.address);

        db.users.collection('addresses').findOne(
            {
                _id: address
            },
            (err, addressData) => {
                if (err) {
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

                db.redis
                    .multi()
                    // sending counters are stored in Redis
                    .get('wdf:' + addressData._id.toString())
                    .ttl('wdf:' + addressData._id.toString())
                    .exec((err, result) => {
                        if (err) {
                            // ignore
                        }

                        let forwards = Number(addressData.forwards) || config.maxForwards || consts.MAX_FORWARDS;

                        let forwardsSent = Number(result && result[0] && result[0][1]) || 0;
                        let forwardsTtl = Number(result && result[1] && result[1][1]) || 0;

                        res.json({
                            success: true,
                            id: addressData._id,
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
                            created: addressData.created
                        });

                        return next();
                    });
            }
        );
    });

    /**
     * @api {get} /addresses/resolve/:address Get Address info
     * @apiName GetAddressInfo
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} address ID of the Address or e-mail address string
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Address
     * @apiSuccess {String} address E-mail address string
     * @apiSuccess {String} name Identity name
     * @apiSuccess {String} user ID of the user if the address belongs to an User
     * @apiSuccess {String[]} targets List of forwarding targets if this is a Forwarded address
     * @apiSuccess {Object} limits Account limits and usage for Forwarded address
     * @apiSuccess {Object} limits.forwards Forwarding quota
     * @apiSuccess {Number} limits.forwards.allowed How many messages per 24 hour can be forwarded
     * @apiSuccess {Number} limits.forwards.used  How many messages are forwarded during current 24 hour period
     * @apiSuccess {Number} limits.forwards.ttl Time until the end of current 24 hour period
     * @apiSuccess {Object} autoreply Autoreply information
     * @apiSuccess {Boolean} autoreply.status If true, then autoreply is enabled for this address
     * @apiSuccess {String} autoreply.name Name that is used for the From: header in autoreply message
     * @apiSuccess {String} autoreply.subject Autoreply subject line
     * @apiSuccess {String} autoreply.text Autoreply plaintext content
     * @apiSuccess {String} autoreply.html Autoreply HTML content
     * @apiSuccess {String[]} tags List of tags associated with the Address
     * @apiSuccess {String} created Datestring of the time the address was created
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/addresses/resolve/k%C3%A4ru%40j%C3%B5geva.ee
     *
     * @apiSuccessExample {json} User-Address:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e81",
     *       "address": "user@example.com",
     *       "user": "59ef21aef255ed1d9d771bb"
     *       "created": "2017-10-24T11:19:10.911Z"
     *     }
     *
     * @apiSuccessExample {json} Forwarded-Address:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59ef21aef255ed1d9d790e81",
     *       "address": "user@example.com",
     *       "targets": [
     *          "my.other.address@example.com"
     *       ],
     *       "limits": {
     *         "forwards": {
     *           "allowed": 2000,
     *           "used": 0,
     *           "ttl": false
     *         }
     *       },
     *       "autoreply": {
     *          "status": false
     *       },
     *       "created": "2017-10-24T11:19:10.911Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This address does not exist"
     *     }
     */
    server.get('/addresses/resolve/:address', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            address: [
                Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                Joi.string().email()
            ]
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let query = {};
        if (result.value.address.indexOf('@') >= 0) {
            let address = tools.normalizeAddress(result.value.address);
            query = {
                addrview: tools.uview(address)
            };
        } else {
            let address = new ObjectID(result.value.address);
            query = {
                _id: address
            };
        }

        db.users.collection('addresses').findOne(query, (err, addressData) => {
            if (err) {
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
                res.json({
                    success: true,
                    id: addressData._id,
                    address: addressData.address,
                    user: addressData.user,
                    tags: addressData.tags || [],
                    created: addressData.created
                });
                return next();
            }

            db.redis
                .multi()
                // sending counters are stored in Redis
                .get('wdf:' + addressData._id.toString())
                .ttl('wdf:' + addressData._id.toString())
                .exec((err, result) => {
                    if (err) {
                        // ignore
                    }

                    let forwards = Number(addressData.forwards) || config.maxForwards || consts.MAX_FORWARDS;

                    let forwardsSent = Number(result && result[0] && result[0][1]) || 0;
                    let forwardsTtl = Number(result && result[1] && result[1][1]) || 0;

                    res.json({
                        success: true,
                        id: addressData._id,
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
                    });

                    return next();
                });
        });
    });

    /**
     * @api {put} /addresses/renameDomain Rename domain in addresses
     * @apiName PutRenameDomain
     * @apiGroup Addresses
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} oldDomain Old Domain Name
     * @apiParam {String} newDomain New Domain Name
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/addresses/renameDomain \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "oldDomain": "example.com",
     *       "newDomain": "blurdybloop.com"
     *     }'
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
     *       "error": "Failed to rename domain"
     *     }
     */
    server.put('/addresses/renameDomain', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            oldDomain: Joi.string().required(),
            newDomain: Joi.string().required()
        });

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let oldDomain = tools.normalizeDomain(result.value.oldDomain);
        let newDomain = tools.normalizeDomain(result.value.newDomain);

        let updateAddresses = [];
        let updateUsers = [];

        let renameDomain = callback => {
            let cursor = db.users.collection('addresses').find({
                addrview: {
                    $regex: '@' + tools.escapeRegexStr(oldDomain) + '$'
                }
            });

            let processNext = () => {
                cursor.next((err, addressData) => {
                    if (err) {
                        return callback(err);
                    }

                    if (!addressData) {
                        return cursor.close(() => {
                            if (!updateAddresses.length) {
                                return callback(null, false);
                            }

                            db.users.collection('addresses').bulkWrite(
                                updateAddresses,
                                {
                                    ordered: false,
                                    w: 1
                                },
                                err => {
                                    if (err) {
                                        return callback(err);
                                    }
                                    db.users.collection('users').bulkWrite(
                                        updateUsers,
                                        {
                                            ordered: false,
                                            w: 1
                                        },
                                        err => {
                                            if (err) {
                                                return callback(err);
                                            }
                                            return callback(null, true);
                                        }
                                    );
                                }
                            );
                        });
                    }

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

                    return setImmediate(processNext);
                });
            };

            processNext();
        };

        renameDomain(err => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            res.json({
                success: true
            });
        });
    });
};
