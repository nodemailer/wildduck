'use strict';

const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const openpgp = require('openpgp');
const addressparser = require('addressparser');
const libmime = require('libmime');

module.exports = (db, server, userHandler) => {
    server.get({ name: 'users', path: '/users' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            query: Joi.string()
                .empty('')
                .alphanum()
                .lowercase()
                .max(128),
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
                unameview: {
                    $regex: query.replace(/\./g, ''),
                    $options: ''
                }
            }
            : {};

        db.users.collection('users').count(filter, (err, total) => {
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
                    username: true,
                    name: true,
                    address: true,
                    storageUsed: true,
                    quota: true,
                    disabled: true
                },
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrevious) {
                opts.previous = pagePrevious;
            }

            MongoPaging.find(db.users.collection('users'), opts, (err, result) => {
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
                    results: (result.results || []).map(userData => ({
                        id: userData._id.toString(),
                        username: userData.username,
                        name: userData.name,
                        address: userData.address,
                        quota: {
                            allowed: Number(userData.quota) || config.maxStorage * 1024 * 1024,
                            used: Math.max(Number(userData.storageUsed) || 0, 0)
                        },
                        disabled: userData.disabled
                    }))
                };

                res.json(response);
                return next();
            });
        });
    });

    server.post('/users', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            username: Joi.string()
                .lowercase()
                .regex(/^[a-z](?:\.?[a-z0-9]+)*$/, 'username')
                .min(3)
                .max(30)
                .required(),
            password: Joi.string()
                .max(256)
                .required(),

            address: Joi.string().email(),

            language: Joi.string()
                .min(2)
                .max(20)
                .lowercase(),
            retention: Joi.number()
                .min(0)
                .default(0),

            name: Joi.string().max(256),
            forward: Joi.string().email(),
            targetUrl: Joi.string().max(256),

            quota: Joi.number()
                .min(0)
                .default(0),
            recipients: Joi.number()
                .min(0)
                .default(0),
            forwards: Joi.number()
                .min(0)
                .default(0),

            pubKey: Joi.string()
                .empty('')
                .trim()
                .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format'),
            encryptMessages: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),

            ip: Joi.string().ip({
                version: ['ipv4', 'ipv6'],
                cidr: 'forbidden'
            })
        });

        let forward = req.params.forward ? tools.normalizeAddress(req.params.forward) : false;

        if (forward && /[\u0080-\uFFFF]/.test(forward)) {
            // replace unicode characters in email addresses before validation
            req.params.forward = forward.replace(/[\u0080-\uFFFF]/g, 'x');
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

        if (forward) {
            result.value.forward = forward;
        }

        if ('pubKey' in req.params && !result.value.pubKey) {
            result.value.pubKey = '';
        }

        checkPubKey(result.value.pubKey, err => {
            if (err) {
                res.json({
                    error: 'PGP key validation failed. ' + err.message
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
    });

    server.get('/users/:user', (req, res, next) => {
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
                        name: userData.name,

                        address: userData.address,

                        language: userData.language,
                        retention: userData.retention || false,

                        enabled2fa: userData.enabled2fa,

                        encryptMessages: userData.encryptMessages,
                        pubKey: userData.pubKey,
                        keyInfo: getKeyInfo(userData.pubKey),

                        forward: userData.forward,
                        targetUrl: userData.targetUrl,

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

                        activated: userData.activated,
                        disabled: userData.disabled
                    });

                    return next();
                });
        });
    });

    server.put('/users/:user', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),

            existingPassword: Joi.string()
                .empty('')
                .min(1)
                .max(256),
            password: Joi.string()
                .min(8)
                .max(256),

            language: Joi.string()
                .min(2)
                .max(20)
                .lowercase(),

            name: Joi.string()
                .empty('')
                .max(256),
            forward: Joi.string()
                .empty('')
                .email(),
            targetUrl: Joi.string()
                .empty('')
                .max(256),

            pubKey: Joi.string()
                .empty('')
                .trim()
                .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format'),
            encryptMessages: Joi.boolean()
                .empty('')
                .truthy(['Y', 'true', 'yes', 1]),

            retention: Joi.number().min(0),
            quota: Joi.number().min(0),
            recipients: Joi.number().min(0),
            forwards: Joi.number().min(0),

            ip: Joi.string().ip({
                version: ['ipv4', 'ipv6'],
                cidr: 'forbidden'
            })
        });

        let forward = req.params.forward ? tools.normalizeAddress(req.params.forward) : false;

        if (forward && /[\u0080-\uFFFF]/.test(forward)) {
            // replace unicode characters in email addresses before validation
            req.params.forward = forward.replace(/[\u0080-\uFFFF]/g, 'x');
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
        if (forward) {
            result.value.forward = forward;
        } else if (!result.value.forward && 'forward' in req.params) {
            result.value.forward = '';
        }

        if (!result.value.targetUrl && 'targetUrl' in req.params) {
            result.value.targetUrl = '';
        }

        if (!result.value.name && 'name' in req.params) {
            result.value.name = '';
        }

        if (!result.value.pubKey && 'pubKey' in req.params) {
            result.value.pubKey = '';
        }

        checkPubKey(result.value.pubKey, err => {
            if (err) {
                res.json({
                    error: 'PGP key validation failed. ' + err.message
                });
                return next();
            }

            userHandler.update(user, result.value, (err, success) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }
                res.json({
                    success
                });
                return next();
            });
        });
    });

    server.post('/users/:user/quota/reset', (req, res, next) => {
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
            // NB! Scattered query
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

    server.post('/users/:user/password/reset', (req, res, next) => {
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

        userHandler.reset(user, (err, password) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            res.json({
                success: true,
                password
            });
            return next();
        });
    });
};

function getKeyInfo(pubKey) {
    if (!pubKey) {
        return false;
    }

    // try to encrypt something with that key
    let armored;
    try {
        armored = openpgp.key.readArmored(pubKey).keys;
    } catch (E) {
        return false;
    }

    if (!armored || !armored[0]) {
        return false;
    }

    let fingerprint = armored[0].primaryKey.fingerprint;
    let name, address;
    if (armored && armored[0] && armored[0].users && armored[0].users[0] && armored[0].users[0].userId) {
        let user = addressparser(armored[0].users[0].userId.userid);
        if (user && user[0] && user[0].address) {
            address = tools.normalizeAddress(user[0].address);
            try {
                name = libmime.decodeWords(user[0].name || '').trim();
            } catch (E) {
                // failed to parse value
                name = user[0].name || '';
            }
        }
    }

    return {
        name,
        address,
        fingerprint
    };
}

function checkPubKey(pubKey, done) {
    if (!pubKey) {
        return done();
    }

    // try to encrypt something with that key
    let armored;
    try {
        armored = openpgp.key.readArmored(pubKey).keys;
    } catch (E) {
        return done(E);
    }

    if (!armored || !armored[0]) {
        return done(new Error('Did not find key information'));
    }

    let fingerprint = armored[0].primaryKey.fingerprint;
    let name, address;
    if (armored && armored[0] && armored[0].users && armored[0].users[0] && armored[0].users[0].userId) {
        let user = addressparser(armored[0].users[0].userId.userid);
        if (user && user[0] && user[0].address) {
            address = tools.normalizeAddress(user[0].address);
            try {
                name = libmime.decodeWords(user[0].name || '').trim();
            } catch (E) {
                // failed to parse value
                name = user[0].name || '';
            }
        }
    }

    openpgp
        .encrypt({
            data: 'Hello, World!',
            publicKeys: armored
        })
        .then(ciphertext => {
            if (/^-----BEGIN PGP MESSAGE/.test(ciphertext.data)) {
                // everything checks out
                return done(null, {
                    address,
                    name,
                    fingerprint
                });
            }

            return done(new Error('Unexpected message'));
        })
        .catch(err => done(err));
}
