'use strict';

const config = require('config');
const restify = require('restify');
const log = require('npmlog');
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
const db = require('./lib/db');
const ObjectID = require('mongodb').ObjectID;
const libqp = require('libqp');
const libbase64 = require('libbase64');

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
        quota: Joi.number().default(config.maxStorage * (1024 * 1024))
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
            filters: [],
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
                subscribed: true,
                flags: []
            }, {
                user,
                path: 'Sent Mail',
                specialUse: '\\Sent',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true,
                flags: []
            }, {
                user,
                path: 'Trash',
                specialUse: '\\Trash',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true,
                flags: []
            }, {
                user,
                path: 'Junk',
                specialUse: '\\Junk',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true,
                flags: []
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
        quota: Joi.number().min(0).optional(),
        recipients: Joi.number().min(0).max(1000000).optional()
    });

    const result = Joi.validate({
        username: req.params.username,
        quota: req.params.quota,
        recipients: req.params.recipients
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
    let recipients = result.value.recipients;

    let $set = {};
    if (quota) {
        $set.quota = quota;
    }
    if (recipients) {
        $set.recipients = recipients;
    }

    if (!quota && !recipients) {
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
            recipients: Number(result.value.recipients) || 0
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

            db.redis.multi().
            get('wdr:' + userData._id.toString()).
            ttl('wdr:' + userData._id.toString()).
            exec((err, result) => {
                if (err) {
                    // ignore
                }
                let recipients = Number(userData.recipients) || 0;
                let recipientsSent = Number(result && result[0]) || 0;
                let recipientsTtl = Number(result && result[1]) || 0;

                res.json({
                    success: true,
                    username,

                    quota: Number(userData.quota) || config.maxStorage * 1024 * 1024,
                    storageUsed: Math.max(Number(userData.storageUsed) || 0, 0),

                    recipients,
                    recipientsSent,

                    recipientsLimited: recipients ? recipients <= recipientsSent : false,
                    recipientsTtl: recipientsTtl >= 0 ? recipientsTtl : false,

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

// FIXME: if listing a page after the last one then there is no prev URL
// Probably should detect the last page the same way the first one is detected
server.get('/mailbox/:id', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        id: Joi.string().hex().lowercase().length(24).required(),
        before: Joi.number().default(0),
        after: Joi.number().default(0),
        size: Joi.number().min(1).max(50).default(20)
    });

    const result = Joi.validate({
        id: req.params.id,
        before: req.params.before,
        after: req.params.after,
        size: req.params.size
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
    let before = result.value.before;
    let after = result.value.after;
    let size = result.value.size;

    db.database.collection('mailboxes').findOne({
        _id: new ObjectID(id)
    }, (err, mailbox) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                id
            });
            return next();
        }
        if (!mailbox) {
            res.json({
                error: 'This mailbox does not exist',
                id
            });
            return next();
        }

        let query = {
            mailbox: mailbox._id
        };
        let reverse = false;
        let sort = [
            ['uid', -1]
        ];

        if (req.params.before) {
            query.uid = {
                $lt: before
            };
        } else if (req.params.after) {
            query.uid = {
                $gt: after
            };
            sort = [
                ['uid', 1]
            ];
            reverse = true;
        }

        db.database.collection('messages').findOne({
            mailbox: mailbox._id
        }, {
            fields: {
                uid: true
            },
            sort: [
                ['uid', -1]
            ]
        }, (err, entry) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    id
                });
                return next();
            }

            if (!entry) {
                res.json({
                    success: true,
                    mailbox: {
                        id: mailbox._id,
                        path: mailbox.path
                    },
                    next: false,
                    prev: false,
                    messages: []
                });
                return next();
            }

            let newest = entry.uid;

            db.database.collection('messages').findOne({
                mailbox: mailbox._id
            }, {
                fields: {
                    uid: true
                },
                sort: [
                    ['uid', 1]
                ]
            }, (err, entry) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        id
                    });
                    return next();
                }

                if (!entry) {
                    res.json({
                        error: 'Unexpected result'
                    });
                    return next();
                }

                let oldest = entry.uid;

                db.database.collection('messages').find(query, {
                    uid: true,
                    mailbox: true,
                    idate: true,
                    headers: true,
                    ha: true,
                    intro: true
                }).sort(sort).limit(size).toArray((err, messages) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            id
                        });
                        return next();
                    }

                    if (reverse) {
                        messages = messages.reverse();
                    }

                    let nextPage = false;
                    let prevPage = false;

                    if (messages.length) {
                        if (after || before) {
                            prevPage = messages[0].uid;
                            if (prevPage >= newest) {
                                prevPage = false;
                            }
                        }
                        if (messages.length >= size) {
                            nextPage = messages[messages.length - 1].uid;
                            if (nextPage < oldest) {
                                nextPage = false;
                            }
                        }
                    }

                    res.json({
                        success: true,
                        mailbox: {
                            id: mailbox._id,
                            path: mailbox.path
                        },
                        next: nextPage ? '/mailbox/' + id + '?before=' + nextPage + '&size=' + size : false,
                        prev: prevPage ? '/mailbox/' + id + '?after=' + prevPage + '&size=' + size : false,
                        messages: messages.map(message => {
                            let response = {
                                id: message._id,
                                date: message.idate,
                                ha: message.ha,
                                intro: message.intro
                            };

                            message.headers.forEach(entry => {
                                if (['subject', 'from', 'to', 'cc', 'bcc'].includes(entry.key)) {
                                    response[entry.key] = entry.value;
                                }
                            });
                            return response;
                        })
                    });

                    return next();
                });
            });
        });
    });
});

server.get('/message/:id', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        id: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).optional()
    });

    const result = Joi.validate({
        id: req.params.id,
        mailbox: req.params.mailbox
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
    let mailbox = result.value.mailbox;

    let query = {
        _id: new ObjectID(id)
    };

    if (mailbox) {
        query.mailbox = new ObjectID(mailbox);
    }

    db.database.collection('messages').findOne(query, {
        mailbox: true,
        headers: true,
        html: true,
        text: true,
        attachments: true,
        idate: true,
        flags: true
    }, (err, message) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                id
            });
            return next();
        }
        if (!message) {
            res.json({
                error: 'This message does not exist',
                id
            });
            return next();
        }

        res.json({
            success: true,
            message: {
                id,
                mailbox: message.mailbox,
                headers: message.headers,
                date: message.idate,
                flags: message.flags,
                text: message.text,
                html: message.html,
                attachments: message.attachments
            }
        });

        return next();
    });
});

server.get('/message/:id/raw', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        id: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).optional()
    });

    const result = Joi.validate({
        id: req.params.id,
        mailbox: req.params.mailbox
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
    let mailbox = result.value.mailbox;

    let query = {
        _id: new ObjectID(id)
    };

    if (mailbox) {
        query.mailbox = new ObjectID(mailbox);
    }

    db.database.collection('messages').findOne(query, {
        mimeTree: true,
        size: true
    }, (err, message) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                id
            });
            return next();
        }
        if (!message) {
            res.json({
                error: 'This message does not exist',
                id
            });
            return next();
        }

        let response = messageHandler.indexer.rebuild(message.mimeTree);
        if (!response || response.type !== 'stream' || !response.value) {
            res.json({
                error: 'Can not fetch message',
                id
            });
            return next();
        }

        res.writeHead(200, {
            'Content-Type': 'message/rfc822'
        });
        response.value.pipe(res);
    });
});

server.get('/message/:message/attachment/:attachment', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        message: Joi.string().hex().lowercase().length(24).required(),
        attachment: Joi.string().hex().lowercase().length(24).required()
    });

    const result = Joi.validate({
        message: req.params.message,
        attachment: req.params.attachment
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

    let message = result.value.message;
    let attachment = result.value.attachment;

    let query = {
        _id: new ObjectID(attachment),
        'metadata.messages': new ObjectID(message)
    };

    db.database.collection('attachments.files').findOne(query, (err, messageData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                attachment,
                message
            });
            return next();
        }
        if (!messageData) {
            res.json({
                error: 'This message does not exist',
                attachment,
                message
            });
            return next();
        }

        res.writeHead(200, {
            'Content-Type': messageData.contentType || 'application/octet-stream'
        });

        let attachmentStream = messageHandler.indexer.gridstore.createReadStream(messageData._id);

        attachmentStream.once('error', err => res.emit('error', err));

        if (messageData.metadata.transferEncoding === 'base64') {
            attachmentStream.pipe(new libbase64.Decoder()).pipe(res);
        } else if (messageData.metadata.transferEncoding === 'quoted-printable') {
            attachmentStream.pipe(new libqp.Decoder()).pipe(res);
        } else {
            attachmentStream.pipe(res);
        }
    });
});

server.del('/message/:id', (req, res, next) => {
    res.charSet('utf-8');

    const schema = Joi.object().keys({
        id: Joi.string().hex().lowercase().length(24).required(),
        mailbox: Joi.string().hex().lowercase().length(24).optional()
    });

    const result = Joi.validate({
        id: req.params.id,
        mailbox: req.params.mailbox
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
    let mailbox = result.value.mailbox;

    let query = {
        _id: new ObjectID(id)
    };

    if (mailbox) {
        query.mailbox = new ObjectID(mailbox);
    }

    messageHandler.del({
        query
    }, (err, success) => {
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
    if (!config.imap.enabled) {
        return setImmediate(() => done(null, false));
    }

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
