'use strict';

const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const addressparser = require('addressparser');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const libbase64 = require('libbase64');
const libqp = require('libqp');

module.exports = (db, server, messageHandler) => {
    server.get({ name: 'messages', path: '/users/:user/mailboxes/:mailbox/messages' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            limit: Joi.number()
                .empty('')
                .default(20)
                .min(1)
                .max(250),
            order: Joi.any()
                .empty('')
                .allow(['asc', 'desc'])
                .default('desc'),
            next: Joi.string()
                .empty('')
                .alphanum()
                .max(1024),
            previous: Joi.string()
                .empty('')
                .alphanum()
                .max(1024),
            page: Joi.number()
                .empty('')
                .default(1)
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
        let pagePrevious = result.value.previous;
        let sortAscending = result.value.order === 'asc';

        db.database.collection('mailboxes').findOne({
            _id: mailbox,
            user
        }, {
            fields: {
                path: true,
                specialUse: true,
                uidNext: true
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
                mailbox,
                // uid is part of the sharding key so we need it somehow represented in the query
                uid: {
                    $gt: 0,
                    $lt: mailboxData.uidNext
                }
            };

            getFilteredMessageCount(db, filter, (err, total) => {
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
                        'mimeTree.parsedHeader.content-type': true,
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
                } else if (pagePrevious) {
                    opts.previous = pagePrevious;
                }

                MongoPaging.find(db.database.collection('messages'), opts, (err, result) => {
                    if (err) {
                        res.json({
                            error: result.error.message
                        });
                        return next();
                    }

                    if (!result.hasPrevious) {
                        page = 1;
                    }

                    let response = {
                        success: true,
                        total,
                        page,
                        previousCursor: result.hasPrevious ? result.previous : false,
                        nextCursor: result.hasNext ? result.next : false,
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
                            tools.decodeAddresses(from);

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
                            let parsedContentType = parsedHeader['content-type'];
                            if (parsedContentType) {
                                response.contentType = {
                                    value: parsedContentType.value
                                };
                                if (parsedContentType.hasParams) {
                                    response.contentType.params = parsedContentType.params;
                                }

                                if (parsedContentType.subtype === 'encrypted') {
                                    response.encrypted = true;
                                }
                            }

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
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .length(24)
                .empty(''),
            query: Joi.string()
                .trim()
                .max(255)
                .empty(''),
            datestart: Joi.number()
                .label('Start time')
                .empty(''),
            dateend: Joi.number()
                .label('End time')
                .empty(''),
            filterFrom: Joi.string()
                .trim()
                .empty(''),
            filterTo: Joi.string()
                .trim()
                .empty(''),
            filterSubject: Joi.string()
                .trim()
                .empty(''),
            filterAttachments: Joi.boolean()
                .empty('')
                .truthy('true'),
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
        let mailbox = result.value.mailbox ? new ObjectID(result.value.mailbox) : false;
        let query = result.value.query;
        let datestart = result.value.datestart ? new Date(result.value.datestart) : false;
        let dateend = result.value.dateend ? new Date(result.value.dateend) : false;
        let filterFrom = result.value.filterFrom;
        let filterTo = result.value.filterTo;
        let filterSubject = result.value.filterSubject;
        let filterAttachments = result.value.filterAttachments;

        let limit = result.value.limit;
        let page = result.value.page;
        let pageNext = result.value.next;
        let pagePrevious = result.value.previous;

        db.users.collection('users').findOne({
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

            // NB! Scattered query, searches over all user mailboxes and all shards
            let filter = {
                user,
                searchable: true
            };

            if (query) {
                filter.$text = { $search: query, $language: 'none' };
            }

            if (mailbox) {
                filter.mailbox = mailbox;
            }

            if (datestart) {
                if (!filter.idate) {
                    filter.idate = {};
                }
                filter.idate.$gte = datestart;
            }

            if (dateend) {
                if (!filter.idate) {
                    filter.idate = {};
                }
                filter.idate.$lte = dateend;
            }

            if (filterFrom) {
                let regex = filterFrom.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                if (!filter.$and) {
                    filter.$and = [];
                }
                filter.$and.push({
                    headers: {
                        $elemMatch: {
                            key: 'from',
                            value: {
                                $regex: regex,
                                $options: 'i'
                            }
                        }
                    }
                });
            }

            if (filterTo) {
                let regex = filterTo.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                if (!filter.$and) {
                    filter.$and = [];
                }
                filter.$and.push({
                    $or: [
                        {
                            headers: {
                                $elemMatch: {
                                    key: 'to',
                                    value: {
                                        $regex: regex,
                                        $options: 'i'
                                    }
                                }
                            }
                        },
                        {
                            headers: {
                                $elemMatch: {
                                    key: 'cc',
                                    value: {
                                        $regex: regex,
                                        $options: 'i'
                                    }
                                }
                            }
                        }
                    ]
                });
            }

            if (filterSubject) {
                let regex = filterSubject.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                if (!filter.$and) {
                    filter.$and = [];
                }
                filter.$and.push({
                    headers: {
                        $elemMatch: {
                            key: 'subject',
                            value: {
                                $regex: regex,
                                $options: 'i'
                            }
                        }
                    }
                });
            }

            if (filterAttachments) {
                filter.ha = true;
            }

            getFilteredMessageCount(db, filter, (err, total) => {
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
                        'mimeTree.parsedHeader.content-type': true,
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
                } else if (pagePrevious) {
                    opts.previous = pagePrevious;
                }

                MongoPaging.find(db.database.collection('messages'), opts, (err, result) => {
                    if (err) {
                        res.json({
                            error: result.error.message
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
                        results: (result.results || []).map(messageData => {
                            let parsedHeader = (messageData.mimeTree && messageData.mimeTree.parsedHeader) || {};
                            let from = parsedHeader.from ||
                                parsedHeader.sender || [
                                    {
                                        name: '',
                                        address: (messageData.meta && messageData.meta.from) || ''
                                    }
                                ];
                            tools.decodeAddresses(from);

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

                            let parsedContentType = parsedHeader['content-type'];
                            if (parsedContentType) {
                                response.contentType = {
                                    value: parsedContentType.value
                                };
                                if (parsedContentType.hasParams) {
                                    response.contentType.params = parsedContentType.params;
                                }

                                if (parsedContentType.subtype === 'encrypted') {
                                    response.encrypted = true;
                                }
                            }

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
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.number()
                .min(1)
                .required(),
            replaceCidLinks: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
            markAsSeen: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false)
        });

        if (req.query.replaceCidLinks) {
            req.params.replaceCidLinks = req.query.replaceCidLinks;
        }

        if (req.query.markAsSeen) {
            req.params.markAsSeen = req.query.markAsSeen;
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

        db.database.collection('messages').findOne({
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
            tools.decodeAddresses(from);

            let replyTo = parsedHeader['reply-to'];
            if (replyTo) {
                tools.decodeAddresses(replyTo);
            }

            let to = parsedHeader.to;
            if (to) {
                tools.decodeAddresses(to);
            }

            let cc = parsedHeader.cc;
            if (cc) {
                tools.decodeAddresses(cc);
            }

            let list;
            if (parsedHeader['list-id'] || parsedHeader['list-unsubscribe']) {
                let listId = parsedHeader['list-id'];
                if (listId) {
                    listId = addressparser(listId.toString());
                    tools.decodeAddresses(listId);
                    listId = listId.shift();
                }

                let listUnsubscribe = parsedHeader['list-unsubscribe'];
                if (listUnsubscribe) {
                    listUnsubscribe = addressparser(listUnsubscribe.toString());
                    tools.decodeAddresses(listUnsubscribe);
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
                messageData.html = (messageData.html || []).map(html =>
                    html.replace(/attachment:([a-f0-9]+)\/(ATT\d+)/g, (str, mid, aid) =>
                        server.router.render('attachment', { user, mailbox, message, attachment: aid })
                    )
                );
            }

            let ensureSeen = done => {
                if (!result.value.markAsSeen || !messageData.unseen) {
                    return done();
                }
                // we need to mark this message as seen
                return messageHandler.update(user, mailbox, message, { seen: true }, err => {
                    if (err) {
                        res.json({
                            error: err.message
                        });
                        return next();
                    }
                    messageData.unseen = false;
                    done();
                });
            };

            ensureSeen(() => {
                let response = {
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
                    raw: server.router.render('raw', { user, mailbox, message })
                };

                let parsedContentType = parsedHeader['content-type'];
                if (parsedContentType) {
                    response.contentType = {
                        value: parsedContentType.value
                    };
                    if (parsedContentType.hasParams) {
                        response.contentType.params = parsedContentType.params;
                    }

                    if (parsedContentType.subtype === 'encrypted') {
                        response.encrypted = true;
                    }
                }

                res.json(response);
                return next();
            });
        });
    });

    server.get({ name: 'messageevents', path: '/users/:user/mailboxes/:mailbox/messages/:message/events' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.number()
                .min(1)
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
        let mailbox = new ObjectID(result.value.mailbox);
        let message = result.value.message;

        db.database.collection('messages').findOne({
            mailbox,
            uid: message
        }, {
            fields: {
                _id: true,
                msgid: true,
                user: true,
                mailbox: true,
                uid: true,
                meta: true,
                outbound: true
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

            let getLogEntries = done => {
                let logQuery = false;
                if (messageData.outbound && messageData.outbound.length === 1) {
                    logQuery = {
                        id: messageData.outbound[0]
                    };
                } else if (messageData.outbound && messageData.outbound.length > 1) {
                    logQuery = {
                        id: { $in: messageData.outbound }
                    };
                }
                if (!logQuery) {
                    return done(null, []);
                }
                db.database
                    .collection('messagelog')
                    .find(logQuery)
                    .sort({ _id: 1 })
                    .toArray(done);
            };

            getLogEntries((err, logEntries) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }

                let response = {
                    success: true,
                    id: messageData._id,
                    events: []
                        .concat(
                            logEntries.map(entry => ({
                                id: entry.id,
                                seq: entry.seq,
                                action: entry.action,
                                origin: entry.origin || entry.source,
                                src: entry.ip,
                                dst: entry.host,
                                mx: entry.mx,
                                targets: entry.targets,
                                reason: entry.reason,
                                error: entry.error,
                                response: entry.response,
                                messageId: entry['message-id'],
                                from: entry.from,
                                to: entry.to && [].concat(typeof entry.to === 'string' ? entry.to.trim().split(/\s*,\s*/) : entry.to || []),
                                transtype: entry.transtype,
                                time: entry.created
                            }))
                        )
                        .sort((a, b) => a.time - b.time)
                };

                res.json(response);
                return next();
            });
        });
    });

    server.get({ name: 'raw', path: '/users/:user/mailboxes/:mailbox/messages/:message/message.eml' }, (req, res, next) => {
        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.number()
                .min(1)
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
        let mailbox = new ObjectID(result.value.mailbox);
        let message = result.value.message;

        db.database.collection('messages').findOne({
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
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.number()
                .min(1)
                .required(),
            attachment: Joi.string()
                .regex(/^ATT\d+$/i)
                .uppercase()
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
        let mailbox = new ObjectID(result.value.mailbox);
        let message = result.value.message;
        let attachment = result.value.attachment;

        db.database.collection('messages').findOne({
            mailbox,
            uid: message,
            user
        }, {
            fields: {
                _id: true,
                user: true,
                attachments: true,
                'mimeTree.attachmentMap': true
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

            let attachmentId = messageData.mimeTree.attachmentMap && messageData.mimeTree.attachmentMap[attachment];
            if (!attachmentId) {
                res.json({
                    error: 'This attachment does not exist'
                });
                return next();
            }

            messageHandler.attachmentStorage.get(attachmentId, (err, attachmentData) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                res.writeHead(200, {
                    'Content-Type': attachmentData.contentType || 'application/octet-stream'
                });

                let decode = true;

                if (attachmentData.metadata.decoded) {
                    attachmentData.metadata.decoded = false;
                    decode = false;
                }

                let attachmentStream = messageHandler.attachmentStorage.createReadStream(attachmentId, attachmentData);

                attachmentStream.once('error', err => res.emit('error', err));

                if (!decode) {
                    return attachmentStream.pipe(res);
                }

                if (attachmentData.transferEncoding === 'base64') {
                    attachmentStream.pipe(new libbase64.Decoder()).pipe(res);
                } else if (attachmentData.transferEncoding === 'quoted-printable') {
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
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            moveTo: Joi.string()
                .hex()
                .lowercase()
                .length(24),
            message: Joi.string()
                .regex(/^\d+(,\d+)*$|^\d+:\d+$|/i)
                .required(),
            seen: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
            deleted: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
            flagged: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
            draft: Joi.boolean().truthy(['Y', 'true', 'yes', 1]),
            expires: Joi.alternatives().try(
                Joi.date(),
                Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 1])
                    .allow(false)
            )
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
            messageQuery = {
                $in: message
                    .split(',')
                    .map(uid => Number(uid))
                    .sort((a, b) => a - b)
            };
        } else if (/^\d+:\d+$/.test(message)) {
            let parts = message
                .split(':')
                .map(uid => Number(uid))
                .sort((a, b) => a - b);
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
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.number()
                .min(1)
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
                'mimeTree.attachmentMap': true,
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
};
function getFilteredMessageCount(db, filter, done) {
    if (Object.keys(filter).length === 1 && filter.mailbox) {
        // try to use cached value to get the count
        return tools.getMailboxCounter(db, filter.mailbox, false, done);
    }

    db.database.collection('messages').count(filter, (err, total) => {
        if (err) {
            return done(err);
        }
        done(null, total);
    });
}
