'use strict';

const config = require('config');
const restify = require('restify');
const log = require('npmlog');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const tools = require('./lib/tools');
const UserHandler = require('./lib/user-handler');
const db = require('./lib/db');

const server = restify.createServer({
    name: 'Wild Duck API'
});

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

server.post('/user/create', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        password: Joi.string().min(3).max(100).required(),
        quota: Joi.number().default(config.maxStorage * (1024 * 1024))
    });

    const result = Joi.validate(
        {
            username: req.params.username,
            password: req.params.password,
            quota: req.params.quota
        },
        schema,
        {
            abortEarly: false,
            convert: true,
            allowUnknown: true
        }
    );

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    userHandler.create(result.value, (err, user) => {
        if (err) {
            res.json({
                error: err.message,
                username: result.value.username
            });
            return next();
        }

        res.json({
            success: !!user,
            username: result.value.username
        });

        return next();
    });
});

server.post('/user/address/create', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        address: Joi.string().email().required(),
        main: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).optional()
    });

    let username = req.params.username;
    let address = req.params.address;
    let main = req.params.main;

    const result = Joi.validate(
        {
            username,
            address: (address || '').replace(/[\u0080-\uFFFF]/g, 'x'),
            main
        },
        schema,
        {
            abortEarly: false,
            convert: true,
            allowUnknown: true
        }
    );

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    username = result.value.username;
    address = tools.normalizeAddress(address);
    main = result.value.main;

    if (address.indexOf('+') >= 0) {
        res.json({
            error: 'Address can not contain +'
        });
        return next();
    }

    db.database.collection('users').findOne({
        username
    }, (err, userData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }
        if (!userData) {
            res.json({
                error: 'This user does not exist',
                username
            });
            return next();
        }

        db.database.collection('addresses').findOne({
            address
        }, (err, addressData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    username,
                    address
                });
                return next();
            }
            if (addressData) {
                res.json({
                    error: 'This email address already exists',
                    username,
                    address
                });
                return next();
            }

            // insert alias address to email address registry
            db.database.collection('addresses').insertOne({
                user: userData._id,
                address,
                created: new Date()
            }, err => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        address
                    });
                    return next();
                }

                let done = () => {
                    res.json({
                        success: true,
                        username,
                        address
                    });
                    return next();
                };

                if (!userData.address || main) {
                    // register this address as the default address for that user
                    return db.database.collection('users').findOneAndUpdate(
                        {
                            _id: userData._id
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

server.post('/user/quota', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        quota: Joi.number().min(0).optional(),
        recipients: Joi.number().min(0).max(1000000).optional(),
        forwards: Joi.number().min(0).max(1000000).optional()
    });

    const result = Joi.validate(
        {
            username: req.params.username,
            quota: req.params.quota,
            recipients: req.params.recipients,
            forwards: req.params.forwards
        },
        schema,
        {
            abortEarly: false,
            convert: true,
            allowUnknown: true
        }
    );

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    let username = result.value.username;
    let quota = result.value.quota;
    let recipients = result.value.recipients;
    let forwards = result.value.forwards;

    let $set = {};
    if (quota) {
        $set.quota = quota;
    }
    if (recipients) {
        $set.recipients = recipients;
    }
    if (forwards) {
        $set.forwards = forwards;
    }

    if (!quota && !recipients && !forwards) {
        res.json({
            error: 'Nothing was updated'
        });
        return next();
    }

    db.database.collection('users').findOneAndUpdate({
        username
    }, {
        $set
    }, {
        returnOriginal: false
    }, (err, result) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }

        if (!result || !result.value) {
            res.json({
                error: 'This user does not exist',
                username
            });
            return next();
        }

        res.json({
            success: true,
            username,
            quota: Number(result.value.quota) || 0,
            recipients: Number(result.value.recipients) || 0,
            forwards: Number(result.value.forwards) || 0
        });
        return next();
    });
});

server.post('/user/quota/reset', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required()
    });

    const result = Joi.validate(
        {
            username: req.params.username
        },
        schema,
        {
            abortEarly: false,
            convert: true,
            allowUnknown: true
        }
    );

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    let username = result.value.username;

    db.database.collection('users').findOne({
        username
    }, (err, user) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }

        if (!user) {
            res.json({
                error: 'This user does not exist',
                username
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
                            user: user._id
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
                        error: 'MongoDB Error: ' + err.message,
                        username
                    });
                    return next();
                }

                let storageUsed = (result && result[0] && result[0].storageUsed) || 0;

                // update quota counter
                db.database.collection('users').findOneAndUpdate({
                    _id: user._id
                }, {
                    $set: {
                        storageUsed: Number(storageUsed) || 0
                    }
                }, {
                    returnOriginal: false
                }, (err, result) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            username
                        });
                        return next();
                    }

                    if (!result || !result.value) {
                        res.json({
                            error: 'This user does not exist',
                            username
                        });
                        return next();
                    }

                    res.json({
                        success: true,
                        username,
                        previousStorageUsed: user.storageUsed,
                        storageUsed: Number(result.value.storageUsed) || 0
                    });
                    return next();
                });
            });
    });
});

server.post('/user/password', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        password: Joi.string().min(3).max(100).required()
    });

    const result = Joi.validate(
        {
            username: req.params.username,
            password: req.params.password
        },
        schema,
        {
            abortEarly: false,
            convert: true,
            allowUnknown: true
        }
    );

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    let username = result.value.username;
    let password = result.value.password;

    db.database.collection('users').findOneAndUpdate({
        username
    }, {
        $set: {
            password: bcrypt.hashSync(password, 11)
        }
    }, (err, result) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }

        if (!result || !result.value) {
            res.json({
                error: 'This user does not exist',
                username
            });
            return next();
        }

        res.json({
            success: true,
            username
        });

        return next();
    });
});

server.get('/user', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required()
    });

    const result = Joi.validate(
        {
            username: req.query.username
        },
        schema,
        {
            abortEarly: false,
            convert: true,
            allowUnknown: true
        }
    );

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    let username = result.value.username;

    db.database.collection('users').findOne({
        username
    }, (err, userData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }
        if (!userData) {
            res.json({
                error: 'This user does not exist',
                username
            });
            return next();
        }

        db.database
            .collection('addresses')
            .find({
                user: userData._id
            })
            .sort({
                address: 1
            })
            .toArray((err, addresses) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        username
                    });
                    return next();
                }

                if (!addresses) {
                    addresses = [];
                }

                db.redis
                    .multi()
                    .get('wdr:' + userData._id.toString())
                    .ttl('wdr:' + userData._id.toString())
                    .get('wdf:' + userData._id.toString())
                    .ttl('wdf:' + userData._id.toString())
                    .exec((err, result) => {
                        if (err) {
                            // ignore
                        }
                        let recipients = Number(userData.recipients) || 0;
                        let forwards = Number(userData.forwards) || 0;

                        let recipientsSent = Number(result && result[0]) || 0;
                        let recipientsTtl = Number(result && result[1]) || 0;

                        let forwardsSent = Number(result && result[2]) || 0;
                        let forwardsTtl = Number(result && result[3]) || 0;

                        res.json({
                            success: true,
                            username,

                            quota: Number(userData.quota) || config.maxStorage * 1024 * 1024,
                            storageUsed: Math.max(Number(userData.storageUsed) || 0, 0),

                            recipients,
                            recipientsSent,

                            forwards,
                            forwardsSent,

                            recipientsLimited: recipients ? recipients <= recipientsSent : false,
                            recipientsTtl: recipientsTtl >= 0 ? recipientsTtl : false,

                            forwardsLimited: forwards ? forwards <= forwardsSent : false,
                            forwardsTtl: forwardsTtl >= 0 ? forwardsTtl : false,

                            addresses: addresses.map(address => ({
                                id: address._id.toString(),
                                address: address.address,
                                main: address.address === userData.address,
                                created: address.created
                            }))
                        });
                        return next();
                    });
            });
    });
});

module.exports = done => {
    if (!config.imap.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

    userHandler = new UserHandler(db.database, db.redis);

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
