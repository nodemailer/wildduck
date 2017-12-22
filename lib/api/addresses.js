'use strict';

const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination-node6');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');

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
     * @apiSuccess {String} results.address E-mail address string
     * @apiSuccess {String} results.user User ID this address belongs to
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

        let filter = query
            ? {
                address: {
                    // cannot use dotless version as this would break domain search
                    $regex: query.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                    $options: ''
                }
            }
            : {};

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
                    user: true
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
                        address: addressData.address,
                        user: addressData.user.toString()
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
     * Special addresses <code>*@example.com</code> and <code>username@*</code> catches all emails to these domains or users without a registered destination (requires <code>allowWildcard</code> argument)
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} address E-mail Address
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
            main: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
            allowWildcard: Joi.boolean().truthy(['Y', 'true', 'yes', 1])
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
                        addrview: address.substr(0, address.indexOf('@')).replace(/\./g, '') + address.substr(address.indexOf('@'))
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
                                error: 'This email address already exists'
                            });
                            return next();
                        }

                        // insert alias address to email address registry
                        db.users.collection('addresses').insertOne(
                            {
                                user,
                                address,
                                addrview: address.substr(0, address.indexOf('@')).replace(/\./g, '') + address.substr(address.indexOf('@')),
                                created: new Date()
                            },
                            (err, r) => {
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
                            }
                        );
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
     * @apiSuccess {String} results.address E-mail address string
     * @apiSuccess {Boolean} results.main Indicates if this is the default address for the User
     * @apiSuccess {String} results.created Datestring of the time the address was created
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
                                address: address.address,
                                main: address.address === userData.address,
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
                                error: 'Invalid or unknown address'
                            });
                            return next();
                        }

                        res.json({
                            success: true,
                            id: addressData._id,
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
     * @apiParam {String} user ID of the Address
     * @apiParam {Boolean} main Indicates if this is the default address for the User
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
    server.put('/users/:user/addresses/:address', (req, res, next) => {
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
                .required(),
            main: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
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
        let main = result.value.main;

        if (!main) {
            res.json({
                error: 'Cannot unset main status'
            });
            return next();
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
                                error: 'Invalid or unknown email address identifier'
                            });
                            return next();
                        }

                        if (addressData.address === userData.address) {
                            res.json({
                                error: 'Selected address is already the main email address for the user'
                            });
                            return next();
                        }

                        if (addressData.address.indexOf('*') >= 0 && main) {
                            res.json({
                                error: 'Can not set wildcard address as default'
                            });
                            return next();
                        }

                        // insert alias address to email address registry
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
                                error: 'Invalid or unknown email address identifier'
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
};
