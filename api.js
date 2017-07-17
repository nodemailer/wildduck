'use strict';

const config = require('wild-config');
const restify = require('restify');
const log = require('npmlog');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const tools = require('./lib/tools');
const UserHandler = require('./lib/user-handler');
const db = require('./lib/db');
const certs = require('./lib/certs').get('api');
const ObjectID = require('mongodb').ObjectID;

const serverOptions = {
    name: 'Wild Duck API'
};

if (certs && config.api.secure) {
    serverOptions.key = certs.key;
    if (certs.ca) {
        serverOptions.ca = certs.ca;
    }
    serverOptions.certificate = certs.cert;
}

const server = restify.createServer(serverOptions);

let userHandler;

server.use(restify.plugins.queryParser());
server.use(
    restify.plugins.bodyParser({
        maxBodySize: 0,
        mapParams: true,
        mapFiles: false,
        overrideParams: false
    })
);

server.post('/users', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        password: Joi.string().max(256).required(),

        address: Joi.string().email(),

        language: Joi.string().min(2).max(20).lowercase(),
        retention: Joi.number().min(0).default(0),

        quota: Joi.number().min(0).default(0),
        recipients: Joi.number().min(0).default(0),
        forwards: Joi.number().min(0).default(0)
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

    userHandler.create(result.value, (err, id) => {
        if (err) {
            res.json({
                error: err.message,
                username: result.value.username
            });
            return next();
        }

        res.json({
            success: !!id,
            id
        });

        return next();
    });
});

server.put('/users/:user', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),

        password: Joi.string().max(256),

        language: Joi.string().min(2).max(20).lowercase(),

        retention: Joi.number().min(0),
        quota: Joi.number().min(0),
        recipients: Joi.number().min(0),
        forwards: Joi.number().min(0)
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

    let $set = {};
    let updates = false;
    Object.keys(result.value).forEach(key => {
        if (key === 'user') {
            return;
        }
        if (key === 'password') {
            $set.password = bcrypt.hashSync(result.value[key], 11);
            return;
        }
        $set[key] = result.value[key];
        updates = true;
    });

    if (!updates) {
        res.json({
            error: 'Nothing was changed'
        });
        return next();
    }

    db.users.collection('users').findOneAndUpdate({
        _id: user
    }, {
        $set
    }, {
        returnOriginal: false
    }, (err, result) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message
            });
            return next();
        }

        if (!result || !result.value) {
            res.json({
                error: 'This user does not exist'
            });
            return next();
        }

        res.json({
            success: true
        });
        return next();
    });
});

server.post('/users/:user/addresses', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        address: Joi.string().email().required(),
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
            address
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

server.put('/users/:user/addresses/:address', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        address: Joi.string().hex().lowercase().length(24).required(),
        main: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).required()
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
        user: Joi.string().hex().lowercase().length(24).required(),
        address: Joi.string().hex().lowercase().length(24).required()
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

            // insert alias address to email address registry
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

server.post('/users/:user/quota/reset', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required()
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

    let user = new ObjectID(result.value.iuserd);

    db.users.collection('users').findOne({
        _id: user
    }, {
        fields: {
            storageUsed: true
        }
    }, (err, userData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.messageusername
            });
            return next();
        }

        if (!userData) {
            res.json({
                error: 'This user does not exist'
            });
            return next();
        }

        // calculate mailbox size by aggregating the size's of all messages
        db.database
            .collection('messages')
            .aggregate(
                [
                    {
                        $match: {
                            user
                        }
                    },
                    {
                        $group: {
                            _id: {
                                user: '$user'
                            },
                            storageUsed: {
                                $sum: '$size'
                            }
                        }
                    }
                ],
                {
                    cursor: {
                        batchSize: 1
                    }
                }
            )
            .toArray((err, result) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                let storageUsed = (result && result[0] && result[0].storageUsed) || 0;

                // update quota counter
                db.users.collection('users').findOneAndUpdate({
                    _id: userData._id
                }, {
                    $set: {
                        storageUsed: Number(storageUsed) || 0
                    }
                }, {
                    returnOriginal: false
                }, (err, result) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message
                        });
                        return next();
                    }

                    if (!result || !result.value) {
                        res.json({
                            error: 'This user does not exist'
                        });
                        return next();
                    }

                    res.json({
                        success: true,
                        storageUsed: Number(result.value.storageUsed) || 0
                    });
                    return next();
                });
            });
    });
});

server.get('/users/:user', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required()
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

        db.redis
            .multi()
            // sending counters are stored in Redis
            .get('wdr:' + userData._id.toString())
            .ttl('wdr:' + userData._id.toString())
            .get('wdf:' + userData._id.toString())
            .ttl('wdf:' + userData._id.toString())
            .exec((err, result) => {
                if (err) {
                    // ignore
                }
                let recipients = Number(userData.recipients) || config.maxRecipients;
                let forwards = Number(userData.forwards) || config.maxForwards;

                let recipientsSent = Number(result && result[0]) || 0;
                let recipientsTtl = Number(result && result[1]) || 0;

                let forwardsSent = Number(result && result[2]) || 0;
                let forwardsTtl = Number(result && result[3]) || 0;

                res.json({
                    success: true,
                    id: user,

                    username: userData.username,

                    language: userData.language,
                    retention: userData.retention || false,

                    limits: {
                        quota: {
                            allowed: Number(userData.quota) || config.maxStorage * 1024 * 1024,
                            used: Math.max(Number(userData.storageUsed) || 0, 0)
                        },
                        recipients: {
                            allowed: recipients,
                            used: recipientsSent,
                            ttl: recipientsTtl >= 0 ? recipientsTtl : false
                        },
                        forwards: {
                            allowed: forwards,
                            used: forwardsSent,
                            ttl: forwardsTtl >= 0 ? forwardsTtl : false
                        }
                    },

                    address: userData.address
                });

                return next();
            });
    });
});

server.get('/users/:user/addresses', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required()
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
                address: 1
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

                    addresses: addresses.map(address => ({
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
        user: Joi.string().hex().lowercase().length(24).required(),
        address: Joi.string().hex().lowercase().length(24).required()
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

module.exports = done => {
    if (!config.imap.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

    userHandler = new UserHandler({ database: db.database, users: db.users, redis: db.redis });

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }

        log.error('API', err);
    });

    server.listen(config.api.port, config.api.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        log.info('API', 'Server listening on %s:%s', config.api.host || '0.0.0.0', config.api.port);
        done(null, server);
    });
};
