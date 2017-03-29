'use strict';

const config = require('config');
const restify = require('restify');
const log = require('npmlog');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
const db = require('./lib/db');

const server = restify.createServer({
    name: 'Wild Duck API',
    formatters: {
        'application/json': (req, res, body, cb) => cb(null, JSON.stringify(body, null, 2)),
        'text/html': (req, res, body, cb) => cb(null, body)
    }
});

let messageHandler;

server.use(restify.queryParser());
server.use(restify.bodyParser({
    maxBodySize: 0,
    mapParams: true,
    mapFiles: false,
    overrideParams: false
}));

server.post('/user/create', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        password: Joi.string().min(3).max(100).required(),
        quota: Joi.number().default(0)
    });

    const result = Joi.validate({
        username: req.params.username,
        password: req.params.password,
        quota: req.params.quota
    }, schema, {
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

    let username = result.value.username;
    let password = result.value.password;
    let quota = result.value.quota;

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
        if (userData) {
            res.json({
                error: 'This username already exists',
                username
            });
            return next();
        }

        // Insert
        let hash = bcrypt.hashSync(password, 11);
        db.database.collection('users').insertOne({
            username,
            password: hash,
            address: false,
            storageUsed: 0,
            quota,
            created: new Date()
        }, (err, result) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    username
                });
                return next();
            }

            let user = result.insertedId;

            // create folders for user
            let uidValidity = Math.floor(Date.now() / 1000);
            db.database.collection('mailboxes').insertMany([{
                user,
                path: 'INBOX',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true
            }, {
                user,
                path: 'Sent Mail',
                specialUse: '\\Sent',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true
            }, {
                user,
                path: 'Trash',
                specialUse: '\\Trash',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true
            }, {
                user,
                path: 'Junk',
                specialUse: '\\Junk',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true
            }], {
                w: 1,
                ordered: false
            }, err => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
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

    const result = Joi.validate({
        username,
        address: (address || '').replace(/[\u0080-\uFFFF]/g, 'x'),
        main
    }, schema, {
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
                    return db.database.collection('users').findOneAndUpdate({
                        _id: userData._id
                    }, {
                        $set: {
                            address
                        }
                    }, {}, done);
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
        quota: Joi.number().default(0)
    });

    const result = Joi.validate({
        username: req.params.username,
        quota: req.params.quota
    }, schema, {
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

    let username = result.value.username;
    let quota = result.value.quota;

    db.database.collection('users').findOneAndUpdate({
        username
    }, {
        $set: {
            quota
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
            username,
            previousQuota: Number(result.value.quota) || 0,
            quota
        });
        return next();
    });
});

server.post('/user/quota/reset', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required()
    });

    const result = Joi.validate({
        username: req.params.username
    }, schema, {
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
        db.database.collection('messages').aggregate([{
            $match: {
                user: user._id
            }
        }, {
            $group: {
                _id: {
                    user: '$user'
                },
                storageUsed: {
                    $sum: '$size'
                }
            }
        }], {
            cursor: {
                batchSize: 1
            }
        }).toArray((err, result) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    username
                });
                return next();
            }

            let storageUsed = result && result[0] && result[0].storageUsed || 0;

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
                    previousStorageUsed: Number(result.value.storageUsed) || 0,
                    storageUsed: user.storageUsed
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

    const result = Joi.validate({
        username: req.params.username,
        password: req.params.password
    }, schema, {
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

    const result = Joi.validate({
        username: req.query.username
    }, schema, {
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

        db.database.collection('addresses').find({
            user: userData._id
        }).sort({
            address: 1
        }).toArray((err, addresses) => {
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

            res.json({
                success: true,
                username,
                quota: Number(userData.quota) || config.imap.maxStorage * 1024 * 1024,
                storageUsed: Math.max(Number(userData.storageUsed) || 0, 0),
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

server.get('/user/mailboxes', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required()
    });

    const result = Joi.validate({
        username: req.query.username
    }, schema, {
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

        db.database.collection('mailboxes').find({
            user: userData._id
        }).toArray((err, mailboxes) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    username
                });
                return next();
            }

            if (!mailboxes) {
                mailboxes = [];
            }

            let priority = {
                Inbox: 1,
                Sent: 2,
                Junk: 3,
                Trash: 4
            };

            res.json({
                success: true,
                username,
                mailboxes: mailboxes.map(mailbox => ({
                    id: mailbox._id.toString(),
                    path: mailbox.path,
                    special: mailbox.path === 'INBOX' ? 'Inbox' : (mailbox.specialUse ? mailbox.specialUse.replace(/^\\/, '') : false)
                })).sort((a, b) => {
                    if (a.special && !b.special) {
                        return -1;
                    }

                    if (b.special && !a.special) {
                        return 1;
                    }

                    if (a.special && b.special) {
                        return (priority[a.special] || 5) - (priority[b.special] || 5);
                    }

                    return a.path.localeCompare(b.path);
                })
            });
            return next();
        });
    });
});

server.del('/message', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        id: Joi.string().hex().lowercase().length(24).required()
    });

    const result = Joi.validate({
        id: req.params.id
    }, schema, {
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

    let id = result.value.id;

    messageHandler.del(id, (err, success) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                id
            });
            return next();
        }

        res.json({
            success,
            id
        });
        return next();
    });

});

module.exports = done => {
    let started = false;

    messageHandler = new MessageHandler(db.database);

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
