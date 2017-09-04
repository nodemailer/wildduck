'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');

module.exports = (db, server) => {
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
                .alphanum()
                .max(1024),
            previous: Joi.string()
                .empty('')
                .alphanum()
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
                error: result.error.message
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

    server.post('/users/:user/addresses', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            address: Joi.string()
                .email()
                .required(),
            main: Joi.boolean().truthy(['Y', 'true', 'yes', 1])
        });

        let address = tools.normalizeAddress(req.params.address);

        if (/[\u0080-\uFFFF]/.test(req.params.address)) {
            // replace unicode characters in email addresses before validation
            req.params.address = req.params.address.replace(/[\u0080-\uFFFF]/g, 'x');
        }

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let main = result.value.main;

        if (address.indexOf('+') >= 0) {
            res.json({
                error: 'Address can not contain +'
            });
            return next();
        }

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                address: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
                });
                return next();
            }

            db.users.collection('addresses').findOne({
                addrview: address.substr(0, address.indexOf('@')).replace(/\./g, '') + address.substr(address.indexOf('@'))
            }, (err, addressData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
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
                db.users.collection('addresses').insertOne({
                    user,
                    address,
                    addrview: address.substr(0, address.indexOf('@')).replace(/\./g, '') + address.substr(address.indexOf('@')),
                    created: new Date()
                }, (err, r) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message
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
            });
        });
    });

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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                address: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
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
                            error: 'MongoDB Error: ' + err.message
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
        });
    });

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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let address = new ObjectID(result.value.address);

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                address: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
                });
                return next();
            }

            db.users.collection('addresses').findOne({
                _id: address,
                user
            }, (err, addressData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
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
            });
        });
    });

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
                error: result.error.message
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

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                address: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
                });
                return next();
            }

            db.users.collection('addresses').findOne({
                _id: address
            }, (err, addressData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
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

                // insert alias address to email address registry
                db.users.collection('users').findOneAndUpdate({
                    _id: user
                }, {
                    $set: {
                        address: addressData.address
                    }
                }, {
                    returnOriginal: false
                }, (err, r) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message
                        });
                        return next();
                    }

                    res.json({
                        success: !!r.value
                    });
                    return next();
                });
            });
        });
    });

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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let address = new ObjectID(result.value.address);

        db.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                address: true
            }
        }, (err, userData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist'
                });
                return next();
            }

            db.users.collection('addresses').findOne({
                _id: address
            }, (err, addressData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
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
                db.users.collection('addresses').deleteOne({
                    _id: address
                }, (err, r) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message
                        });
                        return next();
                    }

                    res.json({
                        success: !!r.deletedCount
                    });
                    return next();
                });
            });
        });
    });
};
