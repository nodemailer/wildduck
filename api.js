'use strict';

const config = require('wild-config');
const restify = require('restify');
const log = require('npmlog');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');
const tools = require('./lib/tools');
const consts = require('./lib/consts');
const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const ImapNotifier = require('./lib/imap-notifier');
const db = require('./lib/db');
const MongoPaging = require('mongo-cursor-pagination');
const certs = require('./lib/certs').get('api');
const ObjectID = require('mongodb').ObjectID;
const imapTools = require('./imap-core/lib/imap-tools');

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

if (certs && config.api.secure) {
    serverOptions.key = certs.key;
    if (certs.ca) {
        serverOptions.ca = certs.ca;
    }
    serverOptions.certificate = certs.cert;
}

const server = restify.createServer(serverOptions);

let userHandler;
let mailboxHandler;
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
                error: result.error.message
            });
            return next();
        }

        let opts = {
            limit,
            query: filter,
            fields: {
                _id: true,
                username: true,
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
                    error: result.error.message
                });
                return next();
            }

            if (!result.hasPrevious) {
                page = 1;
            }

            let prevUrl = result.hasPrevious
                ? server.router.render('users', {}, { prev: result.previous, limit, query: query || '', page: Math.max(page - 1, 1) })
                : false;
            let nextUrl = result.hasNext ? server.router.render('users', {}, { next: result.previous, limit, query: query || '', page: page + 1 }) : false;

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
        query: Joi.string().empty('').max(255),
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
                error: result.error.message
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
                    error: result.error.message
                });
                return next();
            }

            if (!result.hasPrevious) {
                page = 1;
            }

            let prevUrl = result.hasPrevious
                ? server.router.render('addresses', {}, { prev: result.previous, limit, query: query || '', page: Math.max(page - 1, 1) })
                : false;
            let nextUrl = result.hasNext ? server.router.render('addresses', {}, { next: result.previous, limit, query: query || '', page: page + 1 }) : false;

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

                    address: userData.address,

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
                            mailboxes: responses
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
                case 'FETCH':
                case 'EXISTS':
                case 'EXPUNGE':
                    if (e.mailbox) {
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
