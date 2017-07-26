'use strict';

const config = require('wild-config');
const restify = require('restify');
const log = require('npmlog');
const Joi = require('joi');
const crypto = require('crypto');
const tools = require('./lib/tools');
const consts = require('./lib/consts');
const mobileconfig = require('mobileconfig');
const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const MessageHandler = require('./lib/message-handler');
const ImapNotifier = require('./lib/imap-notifier');
const db = require('./lib/db');
const MongoPaging = require('mongo-cursor-pagination');
const certs = require('./lib/certs');
const ObjectID = require('mongodb').ObjectID;
const imapTools = require('./imap-core/lib/imap-tools');
const libmime = require('libmime');
const addressparser = require('addressparser');
const punycode = require('punycode');
const GridFSBucket = require('mongodb').GridFSBucket;
const libbase64 = require('libbase64');
const libqp = require('libqp');
const urllib = require('url');
const apiCerts = certs.get('api');
const mobileconfigCerts = certs.get('api.mobileconfig');

const serverOptions = {
    name: 'Wild Duck API',
    strictRouting: true,
    formatters: {
        'application/json; q=0.4': (req, res, body) => {
            let data = body ? JSON.stringify(body, false, 2) + '\n' : 'null';
            res.setHeader('Content-Length', Buffer.byteLength(data));
            return data;
        }
    }
};

if (apiCerts && config.api.secure) {
    serverOptions.key = apiCerts.key;
    if (apiCerts.ca) {
        serverOptions.ca = apiCerts.ca;
    }
    serverOptions.certificate = apiCerts.cert;
}

const server = restify.createServer(serverOptions);

let userHandler;
let mailboxHandler;
let messageHandler;
let notifier;

// disable compression for EventSource response
// this needs to be called before gzipResponse
server.use((req, res, next) => {
    if (req.route.path === '/users/:user/updates') {
        req.headers['accept-encoding'] = '';
    }
    next();
});
server.use(restify.plugins.gzipResponse());

server.use(restify.plugins.queryParser());
server.use(
    restify.plugins.bodyParser({
        maxBodySize: 0,
        mapParams: true,
        mapFiles: false,
        overrideParams: false
    })
);
server.get(
    /\/public\/?.*/,
    restify.plugins.serveStatic({
        directory: __dirname,
        default: 'index.html'
    })
);

server.use((req, res, next) => {
    if (config.api.accessToken && req.query.accessToken !== config.api.accessToken) {
        res.status(403);
        res.charSet('utf-8');
        return res.json({
            error: 'Invalid accessToken value'
        });
    }
    if (req.query.accessToken) {
        delete req.query.accessToken;
    }
    next();
});

server.get({ name: 'users', path: '/users' }, (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        query: Joi.string().alphanum().lowercase().empty('').max(100),
        limit: Joi.number().default(20).min(1).max(250),
        next: Joi.string().alphanum().max(100),
        prev: Joi.string().alphanum().max(100),
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
    let pagePrev = result.value.prev;

    let filter = query
        ? {
            username: {
                $regex: query,
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
        } else if (pagePrev) {
            opts.prev = pagePrev;
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

            let prevUrl = result.hasPrevious
                ? server.router.render('users', {}, { prev: result.previous, limit, query: query || '', page: Math.max(page - 1, 1) })
                : false;
            let nextUrl = result.hasNext ? server.router.render('users', {}, { next: result.next, limit, query: query || '', page: page + 1 }) : false;

            let response = {
                success: true,
                query,
                total,
                page,
                prev: prevUrl,
                next: nextUrl,
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

server.get({ name: 'addresses', path: '/addresses' }, (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        query: Joi.string().trim().empty('').max(255),
        limit: Joi.number().default(20).min(1).max(250),
        next: Joi.string().alphanum().max(100),
        prev: Joi.string().alphanum().max(100),
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
    let pagePrev = result.value.prev;

    let filter = query
        ? {
            address: {
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
            sortAscending: true
        };

        if (pageNext) {
            opts.next = pageNext;
        } else if (pagePrev) {
            opts.prev = pagePrev;
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

            let prevUrl = result.hasPrevious
                ? server.router.render('addresses', {}, { prev: result.previous, limit, query: query || '', page: Math.max(page - 1, 1) })
                : false;
            let nextUrl = result.hasNext ? server.router.render('addresses', {}, { next: result.next, limit, query: query || '', page: page + 1 }) : false;

            let response = {
                success: true,
                query,
                total,
                page,
                prev: prevUrl,
                next: nextUrl,
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

server.post('/users', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        password: Joi.string().max(256).required(),

        address: Joi.string().email(),

        language: Joi.string().min(2).max(20).lowercase(),
        retention: Joi.number().min(0).default(0),

        name: Joi.string().max(256),
        forward: Joi.string().email(),
        targetUrl: Joi.string().max(256),

        quota: Joi.number().min(0).default(0),
        recipients: Joi.number().min(0).default(0),
        forwards: Joi.number().min(0).default(0),

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

server.post('/authenticate', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        password: Joi.string().max(256).required(),

        protocol: Joi.string().default('API'),
        scope: Joi.string().default('master'),

        ip: Joi.string().ip({
            version: ['ipv4', 'ipv6'],
            cidr: 'forbidden'
        })
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

    let meta = {
        protocol: result.value.protocol,
        ip: result.value.ip
    };

    userHandler.authenticate(result.value.username, result.value.password, result.value.scope, meta, (err, authData) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (!authData) {
            res.json({
                error: 'Authentication failed'
            });
            return next();
        }

        res.json({
            success: true,
            id: authData.user,
            username: authData.username,
            scope: authData.scope,
            require2fa: authData.require2fa
        });

        return next();
    });
});

server.put('/users/:user', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),

        existingPassword: Joi.string().min(1).max(256),
        password: Joi.string().min(8).max(256),

        language: Joi.string().min(2).max(20).lowercase(),

        name: Joi.string().max(256),
        forward: Joi.string().email(),
        targetUrl: Joi.string().max(256),

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
                    name: userData.name,

                    address: userData.address,

                    language: userData.language,
                    retention: userData.retention || false,

                    enabled2fa: userData.enabled2fa,

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

server.get('/users/:user/mailboxes', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        counters: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).default(false)
    });

    if (req.query.counters) {
        req.params.counters = req.query.counters;
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
    let counters = result.value.counters;

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

        db.database
            .collection('mailboxes')
            .find({
                user
            })
            .toArray((err, mailboxes) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                if (!mailboxes) {
                    mailboxes = [];
                }

                let list = new Map();

                mailboxes = mailboxes
                    .map(mailbox => {
                        list.set(mailbox.path, mailbox);
                        return mailbox;
                    })
                    .sort((a, b) => {
                        if (a.path === 'INBOX') {
                            return -1;
                        }
                        if (b.path === 'INBOX') {
                            return 1;
                        }
                        if (a.subscribed !== b.subscribed) {
                            return (a.subscribed ? 0 : 1) - (b.subscribed ? 0 : 1);
                        }
                        return a.path.localeCompare(b.path);
                    });

                let responses = [];
                let position = 0;
                let checkMailboxes = () => {
                    if (position >= mailboxes.length) {
                        res.json({
                            success: true,
                            results: responses
                        });

                        return next();
                    }

                    let mailbox = mailboxes[position++];
                    let path = mailbox.path.split('/');
                    let name = path.pop();

                    let response = {
                        id: mailbox._id,
                        name,
                        path: mailbox.path,
                        specialUse: mailbox.specialUse,
                        modifyIndex: mailbox.modifyIndex,
                        subscribed: mailbox.subscribed
                    };

                    if (!counters) {
                        responses.push(response);
                        return setImmediate(checkMailboxes);
                    }

                    getMailboxCounter(mailbox._id, false, (err, total) => {
                        if (err) {
                            // ignore
                        }
                        getMailboxCounter(mailbox._id, 'unseen', (err, unseen) => {
                            if (err) {
                                // ignore
                            }
                            response.total = total;
                            response.unseen = unseen;
                            responses.push(response);
                            return setImmediate(checkMailboxes);
                        });
                    });
                };
                checkMailboxes();
            });
    });
});

server.post('/users/:user/mailboxes', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        path: Joi.string().regex(/\/{2,}|\/$/g, { invert: true }).required(),
        retention: Joi.number().min(0)
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
    let path = imapTools.normalizeMailbox(result.value.path);
    let retention = result.value.retention;

    let opts = {
        subscribed: true
    };
    if (retention) {
        opts.retention = retention;
    }

    mailboxHandler.create(user, path, opts, (err, status, id) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (typeof status === 'string') {
            res.json({
                error: 'Mailbox creation failed with code ' + status
            });
            return next();
        }

        res.json({
            success: !!status,
            id
        });
        return next();
    });
});

server.get('/users/:user/mailboxes/:mailbox', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required()
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
    let mailbox = new ObjectID(result.value.mailbox);

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

        db.database.collection('mailboxes').findOne({
            _id: mailbox,
            user
        }, (err, mailboxData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!mailboxData) {
                res.json({
                    error: 'This mailbox does not exist'
                });
                return next();
            }

            let path = mailboxData.path.split('/');
            let name = path.pop();

            getMailboxCounter(mailbox, false, (err, total) => {
                if (err) {
                    // ignore
                }
                getMailboxCounter(mailbox, 'unseen', (err, unseen) => {
                    if (err) {
                        // ignore
                    }
                    res.json({
                        success: true,
                        id: mailbox,
                        name,
                        path: mailboxData.path,
                        specialUse: mailboxData.specialUse,
                        modifyIndex: mailboxData.modifyIndex,
                        subscribed: mailboxData.subscribed,
                        total,
                        unseen
                    });
                    return next();
                });
            });
        });
    });
});

server.put('/users/:user/mailboxes/:mailbox', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required(),
        path: Joi.string().regex(/\/{2,}|\/$/g, { invert: true }),
        retention: Joi.number().min(0),
        subscribed: Joi.boolean().truthy(['Y', 'true', 'yes', 1])
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
    let mailbox = new ObjectID(result.value.mailbox);

    let updates = {};
    let update = false;
    Object.keys(result.value || {}).forEach(key => {
        if (!['user', 'mailbox'].includes(key)) {
            updates[key] = result.value[key];
            update = true;
        }
    });

    if (!update) {
        res.json({
            error: 'Nothing was changed'
        });
        return next();
    }

    mailboxHandler.update(user, mailbox, updates, (err, status) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (typeof status === 'string') {
            res.json({
                error: 'Mailbox update failed with code ' + status
            });
            return next();
        }

        res.json({
            success: true
        });
        return next();
    });
});

server.del('/users/:user/mailboxes/:mailbox', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required()
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
    let mailbox = new ObjectID(result.value.mailbox);

    mailboxHandler.del(user, mailbox, (err, status) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (typeof status === 'string') {
            res.json({
                error: 'Mailbox deletion failed with code ' + status
            });
            return next();
        }

        res.json({
            success: true
        });
        return next();
    });
});

server.get({ name: 'messages', path: '/users/:user/mailboxes/:mailbox/messages' }, (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required(),
        limit: Joi.number().default(20).min(1).max(250),
        order: Joi.any().allow(['asc', 'desc']).default('desc'),
        next: Joi.string().alphanum().max(100),
        prev: Joi.string().alphanum().max(100),
        page: Joi.number().default(1)
    });

    req.query.user = req.params.user;
    req.query.mailbox = req.params.mailbox;

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

    let user = new ObjectID(result.value.user);
    let mailbox = new ObjectID(result.value.mailbox);
    let limit = result.value.limit;
    let page = result.value.page;
    let pageNext = result.value.next;
    let pagePrev = result.value.prev;
    let sortAscending = result.value.order === 'asc';

    db.database.collection('mailboxes').findOne({
        _id: mailbox,
        user
    }, {
        fields: {
            path: true,
            specialUse: true
        }
    }, (err, mailboxData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message
            });
            return next();
        }
        if (!mailboxData) {
            res.json({
                error: 'This mailbox does not exist'
            });
            return next();
        }

        let filter = {
            mailbox
        };

        getFilteredMessageCount(filter, (err, total) => {
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
                    uid: true,
                    'meta.from': true,
                    hdate: true,
                    subject: true,
                    'mimeTree.parsedHeader.from': true,
                    'mimeTree.parsedHeader.sender': true,
                    ha: true,
                    intro: true,
                    unseen: true,
                    undeleted: true,
                    flagged: true,
                    draft: true,
                    thread: true
                },
                paginatedField: 'uid',
                sortAscending
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrev) {
                opts.prev = pagePrev;
            }

            MongoPaging.find(db.users.collection('messages'), opts, (err, result) => {
                if (err) {
                    res.json({
                        error: result.error.message
                    });
                    return next();
                }

                if (!result.hasPrevious) {
                    page = 1;
                }

                let prevUrl = result.hasPrevious
                    ? server.router.render(
                        'messages',
                        { user: user.toString(), mailbox: mailbox.toString() },
                        { prev: result.previous, limit, order: sortAscending ? 'asc' : 'desc', page: Math.max(page - 1, 1) }
                    )
                    : false;
                let nextUrl = result.hasNext
                    ? server.router.render(
                        'messages',
                        { user: user.toString(), mailbox: mailbox.toString() },
                        { next: result.next, limit, order: sortAscending ? 'asc' : 'desc', page: page + 1 }
                    )
                    : false;

                let response = {
                    success: true,
                    total,
                    page,
                    prev: prevUrl,
                    next: nextUrl,
                    specialUse: mailboxData.specialUse,
                    results: (result.results || []).map(messageData => {
                        let parsedHeader = (messageData.mimeTree && messageData.mimeTree.parsedHeader) || {};
                        let from = parsedHeader.from ||
                        parsedHeader.sender || [
                                {
                                    name: '',
                                    address: (messageData.meta && messageData.meta.from) || ''
                                }
                            ];
                        decodeAddresses(from);

                        let response = {
                            id: messageData.uid,
                            mailbox,
                            thread: messageData.thread,
                            from: from && from[0],
                            subject: messageData.subject,
                            date: messageData.hdate.toISOString(),
                            intro: messageData.intro,
                            attachments: !!messageData.ha,
                            seen: !messageData.unseen,
                            deleted: !messageData.undeleted,
                            flagged: messageData.flagged,
                            draft: messageData.draft,
                            url: server.router.render('message', { user, mailbox, message: messageData.uid })
                        };
                        return response;
                    })
                };

                res.json(response);
                return next();
            });
        });
    });
});

server.get({ name: 'search', path: '/users/:user/search' }, (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        query: Joi.string().trim().max(255).required(),
        limit: Joi.number().default(20).min(1).max(250),
        next: Joi.string().alphanum().max(100),
        prev: Joi.string().alphanum().max(100),
        page: Joi.number().default(1)
    });

    req.query.user = req.params.user;

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

    let user = new ObjectID(result.value.user);
    let query = result.value.query;
    let limit = result.value.limit;
    let page = result.value.page;
    let pageNext = result.value.next;
    let pagePrev = result.value.prev;

    db.database.collection('users').findOne({
        _id: user
    }, {
        fields: {
            username: true,
            address: true,
            specialUse: true
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

        let filter = {
            user,
            searchable: true,
            $text: { $search: query, $language: 'none' }
        };

        getFilteredMessageCount(filter, (err, total) => {
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
                    uid: true,
                    mailbox: true,
                    'meta.from': true,
                    hdate: true,
                    subject: true,
                    'mimeTree.parsedHeader.from': true,
                    'mimeTree.parsedHeader.sender': true,
                    ha: true,
                    intro: true,
                    unseen: true,
                    undeleted: true,
                    flagged: true,
                    draft: true,
                    thread: true
                },
                paginatedField: '_id',
                sortAscending: false
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrev) {
                opts.prev = pagePrev;
            }

            MongoPaging.find(db.users.collection('messages'), opts, (err, result) => {
                if (err) {
                    res.json({
                        error: result.error.message
                    });
                    return next();
                }

                if (!result.hasPrevious) {
                    page = 1;
                }

                let prevUrl = result.hasPrevious
                    ? server.router.render('search', { user: user.toString() }, { prev: result.previous, limit, query, page: Math.max(page - 1, 1) })
                    : false;
                let nextUrl = result.hasNext
                    ? server.router.render('search', { user: user.toString() }, { next: result.next, limit, query, page: page + 1 })
                    : false;

                let response = {
                    success: true,
                    query,
                    total,
                    page,
                    prev: prevUrl,
                    next: nextUrl,
                    results: (result.results || []).map(messageData => {
                        let parsedHeader = (messageData.mimeTree && messageData.mimeTree.parsedHeader) || {};
                        let from = parsedHeader.from ||
                        parsedHeader.sender || [
                                {
                                    name: '',
                                    address: (messageData.meta && messageData.meta.from) || ''
                                }
                            ];
                        decodeAddresses(from);

                        let response = {
                            id: messageData.uid,
                            mailbox: messageData.mailbox,
                            thread: messageData.thread,
                            from: from && from[0],
                            subject: messageData.subject,
                            date: messageData.hdate.toISOString(),
                            intro: messageData.intro,
                            attachments: !!messageData.ha,
                            seen: !messageData.unseen,
                            deleted: !messageData.undeleted,
                            flagged: messageData.flagged,
                            draft: messageData.draft,
                            url: server.router.render('message', { user, mailbox: messageData.mailbox, message: messageData.uid })
                        };
                        return response;
                    })
                };

                res.json(response);
                return next();
            });
        });
    });
});

server.get({ name: 'message', path: '/users/:user/mailboxes/:mailbox/messages/:message' }, (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required(),
        message: Joi.number().min(1).required(),
        replaceCidLinks: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).default(false)
    });

    if (req.query.replaceCidLinks) {
        req.params.replaceCidLinks = req.query.replaceCidLinks;
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
    let mailbox = new ObjectID(result.value.mailbox);
    let message = result.value.message;
    let replaceCidLinks = result.value.replaceCidLinks;

    db.users.collection('messages').findOne({
        mailbox,
        uid: message
    }, {
        fields: {
            _id: true,
            user: true,
            thread: true,
            'meta.from': true,
            'meta.to': true,
            hdate: true,
            'mimeTree.parsedHeader': true,
            subject: true,
            msgid: true,
            exp: true,
            rdate: true,
            ha: true,
            unseen: true,
            undeleted: true,
            flagged: true,
            draft: true,
            attachments: true,
            html: true
        }
    }, (err, messageData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message
            });
            return next();
        }
        if (!messageData || messageData.user.toString() !== user.toString()) {
            res.json({
                error: 'This message does not exist'
            });
            return next();
        }

        let parsedHeader = (messageData.mimeTree && messageData.mimeTree.parsedHeader) || {};

        let from = parsedHeader.from ||
        parsedHeader.sender || [
                {
                    name: '',
                    address: (messageData.meta && messageData.meta.from) || ''
                }
            ];
        decodeAddresses(from);

        let replyTo = parsedHeader['reply-to'];
        if (replyTo) {
            decodeAddresses(replyTo);
        }

        let to = parsedHeader.to;
        if (to) {
            decodeAddresses(to);
        }

        let cc = parsedHeader.cc;
        if (cc) {
            decodeAddresses(cc);
        }

        let list;
        if (parsedHeader['list-id'] || parsedHeader['list-unsubscribe']) {
            let listId = parsedHeader['list-id'];
            if (listId) {
                listId = addressparser(listId.toString());
                decodeAddresses(listId);
                listId = listId.shift();
            }

            let listUnsubscribe = parsedHeader['list-unsubscribe'];
            if (listUnsubscribe) {
                listUnsubscribe = addressparser(listUnsubscribe.toString());
                decodeAddresses(listUnsubscribe);
            }

            list = {
                id: listId,
                unsubscribe: listUnsubscribe
            };
        }

        let expires;
        if (messageData.exp) {
            expires = new Date(messageData.rdate).toISOString();
        }

        if (replaceCidLinks) {
            messageData.html = (messageData.html || [])
                .map(html =>
                    html.replace(/attachment:([a-f0-9]+)\/(ATT\d+)/g, (str, mid, aid) =>
                        server.router.render('attachment', { user, mailbox, message, attachment: aid })
                    )
                );
        }

        res.json({
            success: true,
            id: message,
            from: from[0],
            replyTo,
            to,
            cc,
            subject: messageData.subject,
            messageId: messageData.msgid,
            date: messageData.hdate.toISOString(),
            list,
            expires,
            seen: !messageData.unseen,
            deleted: !messageData.undeleted,
            flagged: messageData.flagged,
            draft: messageData.draft,
            html: messageData.html,
            attachments: (messageData.attachments || []).map(attachment => {
                attachment.url = server.router.render('attachment', { user, mailbox, message, attachment: attachment.id });
                return attachment;
            }),
            raw: server.router.render('attachment', { user, mailbox, message })
        });
        return next();
    });
});

server.get({ name: 'raw', path: '/users/:user/mailboxes/:mailbox/messages/:message/message.eml' }, (req, res, next) => {
    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required(),
        message: Joi.number().min(1).required()
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
    let mailbox = new ObjectID(result.value.mailbox);
    let message = result.value.message;

    db.users.collection('messages').findOne({
        mailbox,
        uid: message
    }, {
        fields: {
            _id: true,
            user: true,
            mimeTree: true
        }
    }, (err, messageData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message
            });
            return next();
        }
        if (!messageData || messageData.user.toString() !== user.toString()) {
            res.json({
                error: 'This message does not exist'
            });
            return next();
        }

        let response = messageHandler.indexer.rebuild(messageData.mimeTree);
        if (!response || response.type !== 'stream' || !response.value) {
            res.json({
                error: 'This message does not exist'
            });
            return next();
        }

        res.setHeader('Content-Type', 'message/rfc822');
        response.value.pipe(res);
    });
});

server.get({ name: 'attachment', path: '/users/:user/mailboxes/:mailbox/messages/:message/attachments/:attachment' }, (req, res, next) => {
    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required(),
        message: Joi.number().min(1).required(),
        attachment: Joi.string().regex(/^ATT\d+$/i).uppercase().required()
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
    let mailbox = new ObjectID(result.value.mailbox);
    let message = result.value.message;
    let attachment = result.value.attachment;

    db.users.collection('messages').findOne({
        mailbox,
        uid: message,
        user
    }, {
        fields: {
            _id: true,
            user: true,
            attachments: true,
            map: true
        }
    }, (err, messageData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message
            });
            return next();
        }
        if (!messageData || messageData.user.toString() !== user.toString()) {
            res.json({
                error: 'This message does not exist'
            });
            return next();
        }

        let attachmentId = messageData.map[attachment];
        if (!attachmentId) {
            res.json({
                error: 'This attachment does not exist'
            });
            return next();
        }

        db.database.collection('attachments.files').findOne({
            _id: attachmentId
        }, (err, attachmentData) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            if (!attachmentData) {
                res.json({
                    error: 'This attachment does not exist'
                });
                return next();
            }

            res.writeHead(200, {
                'Content-Type': attachmentData.contentType || 'application/octet-stream'
            });

            let bucket = new GridFSBucket(db.gridfs, {
                bucketName: 'attachments'
            });
            let attachmentStream = bucket.openDownloadStream(attachmentId);

            attachmentStream.once('error', err => res.emit('error', err));

            if (attachmentData.metadata.transferEncoding === 'base64') {
                attachmentStream.pipe(new libbase64.Decoder()).pipe(res);
            } else if (attachmentData.metadata.transferEncoding === 'quoted-printable') {
                attachmentStream.pipe(new libqp.Decoder()).pipe(res);
            } else {
                attachmentStream.pipe(res);
            }
        });
    });
});

server.put('/users/:user/mailboxes/:mailbox/messages/:message', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required(),
        moveTo: Joi.string().hex().lowercase().length(24),
        message: Joi.string().regex(/^\d+(,\d+)*$|^\d+:\d+$|/i).required(),
        seen: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
        deleted: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
        flagged: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
        draft: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
        expires: Joi.alternatives().try(Joi.date(), Joi.boolean().truthy(['Y', 'true', 'yes', 1]).allow(false))
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
    let mailbox = new ObjectID(result.value.mailbox);
    let moveTo = result.value.moveTo ? new ObjectID(result.value.moveTo) : false;
    let message = result.value.message;

    let messageQuery;

    if (/^\d+$/.test(message)) {
        messageQuery = Number(message);
    } else if (/^\d+(,\d+)*$/.test(message)) {
        messageQuery = { $in: message.split(',').map(uid => Number(uid)).sort((a, b) => a - b) };
    } else if (/^\d+:\d+$/.test(message)) {
        let parts = message.split(':').map(uid => Number(uid)).sort((a, b) => a - b);
        if (parts[0] === parts[1]) {
            messageQuery = parts[0];
        } else {
            messageQuery = {
                $gte: parts[0],
                $lte: parts[1]
            };
        }
    } else {
        res.json({
            error: 'Invalid message identifier'
        });
        return next();
    }

    if (moveTo) {
        return messageHandler.move(
            {
                user,
                source: { user, mailbox },
                destination: { user, mailbox: moveTo },
                updates: result.value,
                messageQuery
            },
            (err, result, info) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                if (!info || !info.destinationUid || !info.destinationUid.length) {
                    res.json({
                        error: 'Could not move message, check if message exists'
                    });
                    return next();
                }

                res.json({
                    success: true,
                    mailbox: moveTo,
                    id: info && info.sourceUid && info.sourceUid.map((uid, i) => [uid, info.destinationUid && info.destinationUid[i]])
                });
                return next();
            }
        );
    }

    return messageHandler.update(user, mailbox, messageQuery, result.value, (err, updated) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (!updated) {
            res.json({
                error: 'No message matched query'
            });
            return next();
        }

        res.json({
            success: true,
            updated
        });
        return next();
    });
});

server.del('/users/:user/mailboxes/:mailbox/messages/:message', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).required(),
        message: Joi.number().min(1).required()
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
    let mailbox = new ObjectID(result.value.mailbox);
    let message = result.value.message;

    db.database.collection('messages').findOne({
        mailbox,
        uid: message
    }, {
        fields: {
            _id: true,
            user: true,
            mailbox: true,
            uid: true,
            size: true,
            map: true,
            magic: true,
            unseen: true
        }
    }, (err, messageData) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (!messageData || messageData.user.toString() !== user.toString()) {
            res.status(404);
            res.json({
                error: 'Message was not found'
            });
            return next();
        }

        return messageHandler.del(
            {
                user,
                mailbox: { user, mailbox },
                message: messageData
            },
            err => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                res.json({
                    success: true
                });
                return next();
            }
        );
    });
});

server.get('/users/:user/filters', (req, res, next) => {
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

        db.database
            .collection('mailboxes')
            .find({
                user
            })
            .project({ _id: 1, path: 1 })
            .sort({ _id: 1 })
            .toArray((err, mailboxes) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                if (!mailboxes) {
                    mailboxes = [];
                }

                db.users
                    .collection('filters')
                    .find({
                        user
                    })
                    .sort({
                        _id: 1
                    })
                    .toArray((err, filters) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message
                            });
                            return next();
                        }

                        if (!filters) {
                            filters = [];
                        }

                        res.json({
                            success: true,

                            results: filters.map(filter => {
                                let descriptions = getFilterStrings(filter, mailboxes);
                                return {
                                    id: filter._id,
                                    name: filter.name,
                                    query: descriptions.query,
                                    action: descriptions.action,
                                    created: filter.created
                                };
                            })
                        });

                        return next();
                    });
            });
    });
});

server.get('/users/:user/filters/:filter', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        filter: Joi.string().hex().lowercase().length(24).required()
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
    let filter = new ObjectID(result.value.filter);

    db.database.collection('filters').findOne({
        _id: filter,
        user
    }, (err, filterData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message
            });
            return next();
        }
        if (!filterData) {
            res.json({
                error: 'This filter does not exist'
            });
            return next();
        }

        db.database
            .collection('mailboxes')
            .find({
                user
            })
            .project({ _id: 1, path: 1 })
            .sort({ _id: 1 })
            .toArray((err, mailboxes) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                if (!mailboxes) {
                    mailboxes = [];
                }

                //let descriptions = getFilterStrings(filterData, mailboxes);

                let result = {
                    success: true,
                    id: filterData._id,
                    name: filterData.name,
                    //query: descriptions.query,
                    //action: descriptions.action,
                    created: filterData.created
                };

                Object.keys((filterData.query && filterData.query.headers) || {}).forEach(key => {
                    result['query_' + key] = filterData.query.headers[key];
                });

                Object.keys(filterData.query || {}).forEach(key => {
                    if (key !== 'headers') {
                        result['query_' + key] = filterData.query[key];
                    }
                });

                Object.keys(filterData.action || {}).forEach(key => {
                    result['action_' + key] = filterData.action[key];
                });

                res.json(result);

                return next();
            });
    });
});

server.del('/users/:user/filters/:filter', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        filter: Joi.string().hex().lowercase().length(24).required()
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
    let filter = new ObjectID(result.value.filter);

    db.database.collection('filters').deleteOne({
        _id: filter,
        user
    }, (err, r) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message
            });
            return next();
        }

        if (!r.deletedCount) {
            res.status(404);
            res.json({
                error: 'Filter was not found'
            });
            return next();
        }

        res.json({
            success: true
        });
        return next();
    });
});

server.post('/users/:user/filters', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),

        name: Joi.string().trim().max(255).empty(''),

        query_from: Joi.string().trim().max(255).empty(''),
        query_to: Joi.string().trim().max(255).empty(''),
        query_subject: Joi.string().trim().max(255).empty(''),
        query_text: Joi.string().trim().max(255).empty(''),
        query_ha: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        query_size: Joi.number().empty(''),

        action_seen: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        action_flag: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        action_delete: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        action_spam: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),

        action_mailbox: Joi.string().hex().lowercase().length(24).empty(''),
        action_forward: Joi.string().email().empty(''),
        action_targetUrl: Joi.string()
            .uri({
                scheme: ['http', 'https'],
                allowRelative: false,
                relativeOnly: false
            })
            .empty('')
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
    let filterData = {
        _id: new ObjectID(),
        user,
        query: {
            headers: {}
        },
        action: {},
        created: new Date()
    };

    if (result.value.name) {
        filterData.name = result.value.name;
    }

    let hasQuery = false;
    let hasAction = false;

    ['from', 'to', 'subject'].forEach(key => {
        if (result.value['query_' + key]) {
            filterData.query.headers[key] = result.value['query_' + key].replace(/\s+/g, ' ');
            hasQuery = true;
        }
    });

    if (result.value.query_text) {
        filterData.query.text = result.value.query_text.replace(/\s+/g, ' ');
        hasQuery = true;
    }

    if (typeof result.value.query_ha === 'boolean') {
        filterData.query.ha = result.value.query_ha;
        hasQuery = true;
    }

    if (result.value.query_size) {
        filterData.query.size = result.value.query_size;
        hasQuery = true;
    }

    ['seen', 'flag', 'delete', 'spam'].forEach(key => {
        if (typeof result.value['action_' + key] === 'boolean') {
            filterData.action[key] = result.value['action_' + key];
            hasAction = true;
        }
    });

    ['forward', 'targetUrl'].forEach(key => {
        if (result.value['action_' + key]) {
            filterData.action[key] = result.value['action_' + key];
            hasAction = true;
        }
    });

    let checkFilterMailbox = done => {
        if (!result.value.action_mailbox) {
            return done();
        }
        db.database.collection('mailboxes').findOne({
            _id: new ObjectID(result.value.action_mailbox),
            user
        }, (err, mailboxData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!mailboxData) {
                res.json({
                    error: 'This mailbox does not exist'
                });
                return next();
            }
            filterData.action.mailbox = mailboxData._id;
            hasAction = true;
            done();
        });
    };

    checkFilterMailbox(() => {
        if (!hasQuery) {
            res.json({
                error: 'Empty filter query'
            });
            return next();
        }

        if (!hasAction) {
            res.json({
                error: 'Empty filter action'
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

            db.users.collection('filters').insertOne(filterData, (err, r) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                res.json({
                    success: !!r.insertedCount,
                    id: filterData._id
                });
                return next();
            });
        });
    });
});

server.put('/users/:user/filters/:filter', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        filter: Joi.string().hex().lowercase().length(24).required(),

        name: Joi.string().trim().max(255).empty(''),

        query_from: Joi.string().trim().max(255).empty(''),
        query_to: Joi.string().trim().max(255).empty(''),
        query_subject: Joi.string().trim().max(255).empty(''),
        query_text: Joi.string().trim().max(255).empty(''),
        query_ha: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        query_size: Joi.number().empty(''),

        action_seen: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        action_flag: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        action_delete: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),
        action_spam: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).empty(''),

        action_mailbox: Joi.string().hex().lowercase().length(24).empty(''),
        action_forward: Joi.string().email().empty(''),
        action_targetUrl: Joi.string()
            .uri({
                scheme: ['http', 'https'],
                allowRelative: false,
                relativeOnly: false
            })
            .empty('')
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
    let filter = new ObjectID(result.value.filter);

    let $set = {};
    let $unset = {};

    if (result.value.name) {
        $set.name = result.value.name;
    }

    let hasQuery = false;
    let hasAction = false;

    ['from', 'to', 'subject'].forEach(key => {
        if (result.value['query_' + key]) {
            $set['query.headers.' + key] = result.value['query_' + key].replace(/\s+/g, ' ');
            hasQuery = true;
        } else if ('query_' + key in req.params) {
            $unset['query.headers.' + key] = true;
            hasQuery = true;
        }
    });

    if (result.value.query_text) {
        $set['query.text'] = result.value.query_text.replace(/\s+/g, ' ');
        hasQuery = true;
    } else if ('query_text' in req.params) {
        $unset['query.text'] = true;
        hasQuery = true;
    }

    if (typeof result.value.query_ha === 'boolean') {
        $set['query.ha'] = result.value.query_ha;
        hasQuery = true;
    } else if ('query_ha' in req.params) {
        $unset['query.ha'] = true;
        hasQuery = true;
    }

    if (result.value.query_size) {
        $set['query.size'] = result.value.query_size;
        hasQuery = true;
    } else if ('query_size' in req.params) {
        $unset['query.size'] = true;
        hasQuery = true;
    }

    ['seen', 'flag', 'delete', 'spam'].forEach(key => {
        if (typeof result.value['action_' + key] === 'boolean') {
            $set['action.' + key] = result.value['action_' + key];
            hasAction = true;
        } else if ('action_' + key in req.params) {
            $unset['action.' + key] = true;
            hasAction = true;
        }
    });

    ['forward', 'targetUrl'].forEach(key => {
        if (result.value['action_' + key]) {
            $set['action.' + key] = result.value['action_' + key];
            hasAction = true;
        } else if ('action_' + key in req.params) {
            $unset['action.' + key] = true;
            hasAction = true;
        }
    });

    let checkFilterMailbox = done => {
        if (!result.value.action_mailbox) {
            if ('action_mailbox' in req.params) {
                $unset['action.mailbox'] = true;
                hasAction = true;
            }
            return done();
        }
        db.database.collection('mailboxes').findOne({
            _id: new ObjectID(result.value.action_mailbox),
            user
        }, (err, mailboxData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }
            if (!mailboxData) {
                res.json({
                    error: 'This mailbox does not exist'
                });
                return next();
            }
            $set['action.mailbox'] = mailboxData._id;
            hasAction = true;
            done();
        });
    };

    checkFilterMailbox(() => {
        if (!hasQuery && !hasAction) {
            res.json({
                error: 'No changes'
            });
            return next();
        }

        let update = {};

        if (Object.keys($set).length) {
            update.$set = $set;
        }

        if (Object.keys($unset).length) {
            update.$unset = $unset;
        }

        db.users.collection('filters').findOneAndUpdate({ _id: filter, user }, update, (err, r) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message
                });
                return next();
            }

            if (!r || !r.value || !r.value._id) {
                res.status(404);
                res.json({
                    error: 'Filter was not found'
                });
                return next();
            }

            res.json({
                success: true
            });
            return next();
        });
    });
});

server.get('/users/:user/asps', (req, res, next) => {
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
            .collection('asps')
            .find({
                user
            })
            .sort({ _id: 1 })
            .toArray((err, asps) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                if (!asps) {
                    asps = [];
                }

                res.json({
                    success: true,

                    results: asps.map(asp => ({
                        id: asp._id,
                        description: asp.description,
                        scopes: asp.scopes,
                        created: asp.created
                    }))
                });

                return next();
            });
    });
});

server.post('/users/:user/asps', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        description: Joi.string().trim().max(255).required(),
        scopes: Joi.array().items(Joi.string().valid('imap', 'pop3', 'smtp', '*').required()).unique(),
        generateMobileconfig: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).default(false),
        ip: Joi.string().ip({
            version: ['ipv4', 'ipv6'],
            cidr: 'forbidden'
        })
    });

    if (typeof req.params.scopes === 'string') {
        req.params.scopes = req.params.scopes.split(',').map(scope => scope.trim()).filter(scope => scope);
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
    let generateMobileconfig = result.value.generateMobileconfig;
    let scopes = result.value.scopes || ['*'];

    if (generateMobileconfig && !scopes.includes('*') && (!scopes.includes('imap') || !scopes.includes('smtp'))) {
        res.json({
            error: 'Profile file requires imap and smtp scopes'
        });
        return next();
    }

    db.users.collection('users').findOne({
        _id: user
    }, {
        fields: {
            username: true,
            name: true,
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

        userHandler.generateASP(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!generateMobileconfig) {
                res.json({
                    success: true,
                    id: result.id,
                    password: result.password
                });
                return next();
            }

            let profileOpts = {};
            Object.keys(config.api.mobileconfig || {}).forEach(key => {
                profileOpts[key] = (config.api.mobileconfig[key] || '').toString().replace(/\{email\}/g, userData.address).trim();
            });

            let options = {
                displayName: profileOpts.displayName,
                displayDescription: profileOpts.displayDescription,
                accountDescription: profileOpts.accountDescription,
                emailAddress: userData.address,
                emailAccountName: userData.name,
                identifier: profileOpts.identifier,
                imap: {
                    hostname: config.imap.setup.hostname,
                    port: config.imap.setup.port || config.imap.port,
                    secure: config.imap.setup.secure,
                    username: userData.username,
                    password: result.password
                },
                smtp: {
                    hostname: config.smtp.setup.hostname,
                    port: config.smtp.setup.port || config.smtp.port,
                    secure: true, //config.setup.smtp.secure,
                    username: userData.username,
                    password: false // use the same password as for IMAP
                },
                keys: mobileconfigCerts
            };

            mobileconfig.getSignedEmailConfig(options, (err, data) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                res.json({
                    success: true,
                    id: result.id,
                    password: result.password,
                    mobileconfig: data.toString('base64')
                });
                return next();
            });
        });
    });
});

server.del('/users/:user/asps/:asp', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        asp: Joi.string().hex().lowercase().length(24).required(),
        ip: Joi.string().ip({
            version: ['ipv4', 'ipv6'],
            cidr: 'forbidden'
        })
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
    let asp = new ObjectID(result.value.asp);

    userHandler.deleteASP(user, asp, result.value, err => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }
        res.json({
            success: true
        });
        return next();
    });
});

server.post('/users/:user/2fa', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        issuer: Joi.string().trim().max(255).required(),
        ip: Joi.string().ip({
            version: ['ipv4', 'ipv6'],
            cidr: 'forbidden'
        })
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

    userHandler.setup2fa(user, result.value, (err, result) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        res.json({
            success: true,
            qrcode: result
        });

        return next();
    });
});

server.get('/users/:user/2fa', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        token: Joi.string().length(6).required(),
        ip: Joi.string().ip({
            version: ['ipv4', 'ipv6'],
            cidr: 'forbidden'
        })
    });

    req.query.user = req.params.user;

    const result = Joi.validate(req.query, schema, {
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

    userHandler.check2fa(user, result.value, (err, result) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (!result) {
            res.json({
                error: 'Invalid authentication token'
            });
            return next();
        }

        res.json({
            success: true
        });

        return next();
    });
});

server.put('/users/:user/2fa', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        token: Joi.string().length(6).required(),
        ip: Joi.string().ip({
            version: ['ipv4', 'ipv6'],
            cidr: 'forbidden'
        })
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

    userHandler.enable2fa(user, result.value, (err, result) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (!result) {
            res.json({
                error: 'Invalid authentication token'
            });
            return next();
        }

        res.json({
            success: true
        });

        return next();
    });
});

server.del('/users/:user/2fa', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        ip: Joi.string().ip({
            version: ['ipv4', 'ipv6'],
            cidr: 'forbidden'
        })
    });

    req.query.user = req.params.user;

    const result = Joi.validate(req.query, schema, {
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

    userHandler.disable2fa(user, result.value, (err, result) => {
        if (err) {
            res.json({
                error: err.message
            });
            return next();
        }

        if (!result) {
            res.json({
                error: 'Invalid authentication token'
            });
            return next();
        }

        res.json({
            success: true
        });

        return next();
    });
});

server.get({ name: 'authlog', path: '/users/:user/authlog' }, (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        limit: Joi.number().default(20).min(1).max(250),
        next: Joi.string().alphanum().max(100),
        prev: Joi.string().alphanum().max(100),
        page: Joi.number().default(1)
    });

    req.query.user = req.params.user;

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

    let user = new ObjectID(result.value.user);
    let limit = result.value.limit;
    let page = result.value.page;
    let pageNext = result.value.next;
    let pagePrev = result.value.prev;

    db.database.collection('users').findOne({
        _id: user
    }, {
        fields: {
            _id: true
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

        let filter = {
            user
        };

        db.database.collection('authlog').count(filter, (err, total) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            let opts = {
                limit,
                query: filter,
                sortAscending: false
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrev) {
                opts.prev = pagePrev;
            }

            MongoPaging.find(db.users.collection('authlog'), opts, (err, result) => {
                if (err) {
                    res.json({
                        error: result.error.message
                    });
                    return next();
                }

                if (!result.hasPrevious) {
                    page = 1;
                }

                let prevUrl = result.hasPrevious
                    ? server.router.render('authlog', { user: user.toString() }, { prev: result.previous, limit, page: Math.max(page - 1, 1) })
                    : false;
                let nextUrl = result.hasNext ? server.router.render('authlog', { user: user.toString() }, { next: result.next, limit, page: page + 1 }) : false;

                let response = {
                    success: true,
                    total,
                    page,
                    prev: prevUrl,
                    next: nextUrl,
                    results: (result.results || []).map(resultData => {
                        let response = {
                            id: resultData._id
                        };

                        Object.keys(resultData).forEach(key => {
                            if (!['_id', 'user'].includes(key)) {
                                response[key] = resultData[key];
                            }
                        });
                        return response;
                    })
                };

                res.json(response);
                return next();
            });
        });
    });
});

server.get('/users/:user/updates', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        user: Joi.string().hex().lowercase().length(24).required(),
        'Last-Event-ID': Joi.string().hex().lowercase().length(24)
    });

    if (req.header('Last-Event-ID')) {
        req.params['Last-Event-ID'] = req.header('Last-Event-ID');
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
    let lastEventId = result.value['Last-Event-ID'] ? new ObjectID(result.value['Last-Event-ID']) : false;

    db.users.collection('users').findOne({
        _id: user
    }, {
        fields: {
            username: true,
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

        let session = { id: crypto.randomBytes(10).toString('base64'), user: { id: userData._id, username: userData.username } };
        let closed = false;
        let idleTimer = false;
        let idleCounter = 0;

        let sendIdleComment = () => {
            clearTimeout(idleTimer);
            if (closed) {
                return;
            }
            res.write(': idling ' + ++idleCounter + '\n\n');
            idleTimer = setTimeout(sendIdleComment, 15 * 1000);
        };

        let resetIdleComment = () => {
            clearTimeout(idleTimer);
            if (closed) {
                return;
            }
            idleTimer = setTimeout(sendIdleComment, 15 * 1000);
        };

        let journalReading = false;
        let journalReader = () => {
            if (journalReading || closed) {
                return;
            }
            journalReading = true;
            loadJournalStream(req, res, user, lastEventId, (err, info) => {
                if (err) {
                    // ignore?
                }
                lastEventId = info && info.lastEventId;
                journalReading = false;
                if (info && info.processed) {
                    resetIdleComment();
                }
            });
        };

        let close = () => {
            closed = true;
            clearTimeout(idleTimer);
            notifier.removeListener(session, '*', journalReader);
        };

        let setup = () => {
            notifier.addListener(session, '*', journalReader);

            let finished = false;
            let done = () => {
                if (finished) {
                    return;
                }
                finished = true;
                close();
                return next();
            };

            req.connection.setTimeout(30 * 60 * 1000, done);
            req.connection.on('end', done);
            req.connection.on('error', done);
        };

        res.writeHead(200, { 'Content-Type': 'text/event-stream' });

        if (lastEventId) {
            loadJournalStream(req, res, user, lastEventId, (err, info) => {
                if (err) {
                    res.write('event: error\ndata: ' + err.message.split('\n').join('\ndata: ') + '\n\n');
                    // ignore
                }
                setup();
                if (info && info.processed) {
                    resetIdleComment();
                } else {
                    sendIdleComment();
                }
            });
        } else {
            db.database.collection('journal').findOne({ user }, { sort: { _id: -1 } }, (err, latest) => {
                if (!err && latest) {
                    lastEventId = latest._id;
                }
                setup();
                sendIdleComment();
            });
        }
    });
});

function formatJournalData(e) {
    let data = {};
    Object.keys(e).forEach(key => {
        if (!['_id', 'ignore', 'user', 'modseq', 'unseenChange', 'created'].includes(key)) {
            if (e.command !== 'COUNTERS' && key === 'unseen') {
                return;
            }
            data[key] = e[key];
        }
    });

    let response = [];
    response.push('data: ' + JSON.stringify(data, false, 2).split('\n').join('\ndata: '));
    if (e._id) {
        response.push('id: ' + e._id.toString());
    }

    return response.join('\n') + '\n\n';
}

function loadJournalStream(req, res, user, lastEventId, done) {
    let query = { user };
    if (lastEventId) {
        query._id = { $gt: lastEventId };
    }

    let mailboxes = new Set();

    let cursor = db.database.collection('journal').find(query).sort({ _id: 1 });
    let processed = 0;
    let processNext = () => {
        cursor.next((err, e) => {
            if (err) {
                return done(err);
            }
            if (!e) {
                return cursor.close(() => {
                    if (!mailboxes.size) {
                        return done(null, {
                            lastEventId,
                            processed
                        });
                    }

                    mailboxes = Array.from(mailboxes);
                    let mailboxPos = 0;
                    let emitCounters = () => {
                        if (mailboxPos >= mailboxes.length) {
                            return done(null, {
                                lastEventId,
                                processed
                            });
                        }
                        let mailbox = new ObjectID(mailboxes[mailboxPos++]);
                        getMailboxCounter(mailbox, false, (err, total) => {
                            if (err) {
                                // ignore
                            }
                            getMailboxCounter(mailbox, 'unseen', (err, unseen) => {
                                if (err) {
                                    // ignore
                                }

                                res.write(
                                    formatJournalData({
                                        command: 'COUNTERS',
                                        _id: lastEventId,
                                        mailbox,
                                        total,
                                        unseen
                                    })
                                );

                                setImmediate(emitCounters);
                            });
                        });
                    };
                    emitCounters();
                });
            }

            lastEventId = e._id;

            if (!e || !e.command) {
                // skip
                return processNext();
            }

            switch (e.command) {
                case 'EXISTS':
                case 'EXPUNGE':
                    if (e.mailbox) {
                        mailboxes.add(e.mailbox.toString());
                    }
                    break;
                case 'FETCH':
                    if (e.mailbox && (e.unseen || e.unseenChange)) {
                        mailboxes.add(e.mailbox.toString());
                    }
                    break;
            }

            res.write(formatJournalData(e));

            processed++;
            processNext();
        });
    };

    processNext();
}

function getFilterStrings(filter, mailboxes) {
    let query = Object.keys(filter.query.headers || {}).map(key => [key, '(' + filter.query.headers[key] + ')']);

    if (filter.query.ha && filter.query.ha > 0) {
        query.push(['has attachment']);
    } else if (filter.query.ha && filter.query.ha < 0) {
        query.push(['no attachments']);
    }

    if (filter.query.text) {
        query.push([false, '"' + filter.query.text + '"']);
    }

    if (filter.query.size) {
        let unit = 'B';
        let size = Math.abs(filter.query.size || 0);
        if (size) {
            if (filter.query.size % (1024 * 1024) === 0) {
                unit = 'MB';
                size = Math.round(size / (1024 * 1024));
            } else if (filter.query.size % 1024 === 0) {
                unit = 'kB';
                size = Math.round(size / 1024);
            }
        }
        if (filter.query.size > 0) {
            query.push(['larger', size + unit]);
        } else if (filter.query.size < 0) {
            query.push(['smaller', size + unit]);
        }
    }

    // process actions
    let action = Object.keys(filter.action || {})
        .map(key => {
            switch (key) {
                case 'seen':
                    if (filter.action[key]) {
                        return ['mark as read'];
                    } else {
                        return ['do not mark as read'];
                    }
                case 'flag':
                    if (filter.action[key]) {
                        return ['flag it'];
                    } else {
                        return ['do not flag it'];
                    }
                case 'mailbox':
                    if (filter.action[key]) {
                        let target = mailboxes.find(mailbox => mailbox._id.toString() === filter.action[key].toString());
                        return ['move to folder', target ? '"' + target.path + '"' : '?'];
                    } else {
                        return ['keep in INBOX'];
                    }
                case 'forward':
                    if (filter.action[key]) {
                        return ['forward to', filter.action[key]];
                    }
                    break;
                case 'targetUrl':
                    if (filter.action[key]) {
                        let url = filter.action[key];
                        let parsed = urllib.parse(url);
                        return ['upload to', parsed.hostname || parsed.host];
                    }
                    break;
                case 'spam':
                    if (filter.action[key] > 0) {
                        return ['mark it as spam'];
                    } else if (filter.action[key] < 0) {
                        return ['do not mark it as spam'];
                    }
                    break;
                case 'delete':
                    if (filter.action[key]) {
                        return ['delete it'];
                    } else {
                        return ['do not delete it'];
                    }
            }
            return false;
        })
        .filter(str => str);
    return {
        query,
        action
    };
}

function getMailboxCounter(mailbox, type, done) {
    let prefix = type ? type : 'total';
    db.redis.get(prefix + ':' + mailbox.toString(), (err, sum) => {
        if (err) {
            return done(err);
        }

        if (sum !== null) {
            return done(null, Number(sum));
        }

        // calculate sum
        let query = { mailbox };
        if (type) {
            query[type] = true;
        }

        db.database.collection('messages').count(query, (err, sum) => {
            if (err) {
                return done(err);
            }

            // cache calculated sum in redis
            db.redis.multi().set(prefix + ':' + mailbox.toString(), sum).expire(prefix + ':' + mailbox.toString(), consts.MAILBOX_COUNTER_TTL).exec(() => {
                done(null, sum);
            });
        });
    });
}

function getFilteredMessageCount(filter, done) {
    if (Object.keys(filter).length === 1 && filter.mailbox) {
        // try to use cached value to get the count
        return getMailboxCounter(filter.mailbox, false, done);
    }

    db.database.collection('messages').count(filter, (err, total) => {
        if (err) {
            return done(err);
        }
        done(null, total);
    });
}

function decodeAddresses(addresses) {
    addresses.forEach(address => {
        address.name = (address.name || '').toString();
        if (address.name) {
            try {
                address.name = libmime.decodeWords(address.name);
            } catch (E) {
                //ignore, keep as is
            }
        }
        if (/@xn--/.test(address.address)) {
            address.address =
                address.address.substr(0, address.address.lastIndexOf('@') + 1) +
                punycode.toUnicode(address.address.substr(address.address.lastIndexOf('@') + 1));
        }
        if (address.group) {
            decodeAddresses(address.group);
        }
    });
}

module.exports = done => {
    if (!config.imap.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

    notifier = new ImapNotifier({
        database: db.database,
        redis: db.redis
    });
    userHandler = new UserHandler({ database: db.database, users: db.users, redis: db.redis });
    mailboxHandler = new MailboxHandler({ database: db.database, users: db.users, redis: db.redis, notifier });
    messageHandler = new MessageHandler({ database: db.database, gridfs: db.gridfs, redis: db.redis });

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
