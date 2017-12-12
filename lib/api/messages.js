'use strict';

const log = require('npmlog');
const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination-node6');
const addressparser = require('addressparser');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const consts = require('../consts');
const libbase64 = require('libbase64');
const libqp = require('libqp');
const forward = require('../forward');

module.exports = (db, server, messageHandler) => {
    /**
     * @api {get} /users/:user/mailboxes/:mailbox/messages List messages in a Mailbox
     * @apiName GetMessages
     * @apiGroup Messages
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} [limit=20] How many records to return
     * @apiParam {Number} [page=1] Current page number. Informational only, page numbers start from 1
     * @apiParam {Number} [order="desc"] Ordering of the records by insert date
     * @apiParam {Number} [next] Cursor value for next page, retrieved from <code>nextCursor</code> response value
     * @apiParam {Number} [previous] Cursor value for previous page, retrieved from <code>previousCursor</code> response value
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Number} total How many results were found
     * @apiSuccess {Number} page Current page number. Derived from <code>page</code> query argument
     * @apiSuccess {String} previousCursor Either a cursor string or false if there are not any previous results
     * @apiSuccess {String} nextCursor Either a cursor string or false if there are not any next results
     * @apiSuccess {Object[]} results Message listing
     * @apiSuccess {Number} results.id ID of the Message
     * @apiSuccess {String} results.mailbox ID of the Mailbox
     * @apiSuccess {String} results.thread ID of the Thread
     * @apiSuccess {Object} results.from Sender info
     * @apiSuccess {String} results.from.name Name of the sender
     * @apiSuccess {String} results.from.address Address of the sender
     * @apiSuccess {String} results.subject Message subject
     * @apiSuccess {String} results.date Datestring
     * @apiSuccess {String} results.intro First 128 bytes of the message
     * @apiSuccess {Boolean} results.attachments Does the message have attachments
     * @apiSuccess {Boolean} results.seen Is this message alread seen or not
     * @apiSuccess {Boolean} results.deleted Does this message have a \Deleted flag (should not have as messages are automatically deleted once this flag is set)
     * @apiSuccess {Boolean} results.flagged Does this message have a \Flagged flag
     * @apiSuccess {Object} results.contentType Parsed Content-Type header. Usually needed to identify encrypted messages and such
     * @apiSuccess {String} results.contentType.value MIME type of the message, eg. "multipart/mixed"
     * @apiSuccess {Object} results.contentType.params An object with Content-Type params as key-value pairs
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "total": 1,
     *       "page": 1,
     *       "previousCursor": false,
     *       "nextCursor": false,
     *       "specialUse": null,
     *       "results": [
     *         {
     *           "id": 1,
     *           "mailbox": "59fc66a03e54454869460e46",
     *           "thread": "59fc66a13e54454869460e50",
     *           "from": {
     *             "address": "rfinnie@domain.dom",
     *             "name": "Ryan Finnie"
     *           },
     *           "subject": "Ryan Finnie's MIME Torture Test v1.0",
     *           "date": "2003-10-24T06:28:34.000Z",
     *           "intro": "Welcome to Ryan Finnie's MIME torture test. This message was designed to introduce a couple of the newer features of MIME-aware…",
     *           "attachments": true,
     *           "seen": true,
     *           "deleted": false,
     *           "flagged": true,
     *           "draft": false,
     *           "url": "/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1",
     *           "contentType": {
     *             "value": "multipart/mixed",
     *             "params": {
     *               "boundary": "=-qYxqvD9rbH0PNeExagh1"
     *             }
     *           }
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
                .mongoCursor()
                .max(1024),
            previous: Joi.string()
                .empty('')
                .mongoCursor()
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

        db.database.collection('mailboxes').findOne(
            {
                _id: mailbox,
                user
            },
            {
                fields: {
                    path: true,
                    specialUse: true,
                    uidNext: true
                }
            },
            (err, mailboxData) => {
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
                            results: (result.results || []).map(formatMessageListing)
                        };

                        res.json(response);
                        return next();
                    });
                });
            }
        );
    });

    /**
     * @api {get} /users/:user/search Search for messages
     * @apiName GetMessagesSearch
     * @apiGroup Messages
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} [mailbox] ID of the Mailbox
     * @apiParam {String} [query] Search string, uses MongoDB fulltext index. Covers data from mesage body and also common headers like from, to, subject etc.
     * @apiParam {String} [datestart] Datestring for the earliest message storing time
     * @apiParam {String} [dateend] Datestring for the latest message storing time
     * @apiParam {String} [from] Partial match for the From: header line
     * @apiParam {String} [to] Partial match for the To: and Cc: header lines
     * @apiParam {String} [subject] Partial match for the Subject: header line
     * @apiParam {Boolean} [attachments] If true, then matches only messages with attachments
     * @apiParam {Boolean} [flagged] If true, then matches only messages with \Flagged flags
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
     * @apiSuccess {Object[]} results Message listing
     * @apiSuccess {Number} results.id ID of the Message
     * @apiSuccess {String} results.mailbox ID of the Mailbox
     * @apiSuccess {String} results.thread ID of the Thread
     * @apiSuccess {Object} results.from Sender info
     * @apiSuccess {String} results.from.name Name of the sender
     * @apiSuccess {String} results.from.address Address of the sender
     * @apiSuccess {String} results.subject Message subject
     * @apiSuccess {String} results.date Datestring
     * @apiSuccess {String} results.intro First 128 bytes of the message
     * @apiSuccess {Boolean} results.attachments Does the message have attachments
     * @apiSuccess {Boolean} results.seen Is this message alread seen or not
     * @apiSuccess {Boolean} results.deleted Does this message have a \Deleted flag (should not have as messages are automatically deleted once this flag is set)
     * @apiSuccess {Boolean} results.flagged Does this message have a \Flagged flag
     * @apiSuccess {String} results.url Relative API url for fetching message contents
     * @apiSuccess {Object} results.contentType Parsed Content-Type header. Usually needed to identify encrypted messages and such
     * @apiSuccess {String} results.contentType.value MIME type of the message, eg. "multipart/mixed"
     * @apiSuccess {Object} results.contentType.params An object with Content-Type params as key-value pairs
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/search?query=Ryan"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "query": "Ryan",
     *       "total": 1,
     *       "page": 1,
     *       "previousCursor": false,
     *       "nextCursor": false,
     *       "specialUse": null,
     *       "results": [
     *         {
     *           "id": 1,
     *           "mailbox": "59fc66a03e54454869460e46",
     *           "thread": "59fc66a13e54454869460e50",
     *           "from": {
     *             "address": "rfinnie@domain.dom",
     *             "name": "Ryan Finnie"
     *           },
     *           "subject": "Ryan Finnie's MIME Torture Test v1.0",
     *           "date": "2003-10-24T06:28:34.000Z",
     *           "intro": "Welcome to Ryan Finnie's MIME torture test. This message was designed to introduce a couple of the newer features of MIME-aware…",
     *           "attachments": true,
     *           "seen": true,
     *           "deleted": false,
     *           "flagged": true,
     *           "draft": false,
     *           "url": "/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1",
     *           "contentType": {
     *             "value": "multipart/mixed",
     *             "params": {
     *               "boundary": "=-qYxqvD9rbH0PNeExagh1"
     *             }
     *           }
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
            datestart: Joi.date()
                .label('Start time')
                .empty(''),
            dateend: Joi.date()
                .label('End time')
                .empty(''),
            from: Joi.string()
                .trim()
                .empty(''),
            to: Joi.string()
                .trim()
                .empty(''),
            subject: Joi.string()
                .trim()
                .empty(''),
            attachments: Joi.boolean()
                .empty('')
                .truthy('true'),
            flagged: Joi.boolean()
                .empty('')
                .truthy('true'),
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
        let datestart = result.value.datestart || false;
        let dateend = result.value.dateend || false;
        let filterFrom = result.value.from;
        let filterTo = result.value.to;
        let filterSubject = result.value.subject;
        let filterAttachments = result.value.attachments;
        let filterFlagged = result.value.flagged;

        let limit = result.value.limit;
        let page = result.value.page;
        let pageNext = result.value.next;
        let pagePrevious = result.value.previous;

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    username: true,
                    address: true,
                    specialUse: true
                }
            },
            (err, userData) => {
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

                let mailboxNeeded = false;

                // NB! Scattered query, searches over all user mailboxes and all shards
                let filter = {
                    user
                };

                if (query) {
                    filter.searchable = true;
                    filter.$text = { $search: query, $language: 'none' };
                }

                if (mailbox) {
                    filter.mailbox = mailbox;
                }

                if (filterFlagged) {
                    // mailbox is not needed as there's a special index for flagged messages
                    filter.flaged = true;
                }

                if (datestart) {
                    if (!filter.idate) {
                        filter.idate = {};
                    }
                    filter.idate.$gte = datestart;
                    mailboxNeeded = true;
                }

                if (dateend) {
                    if (!filter.idate) {
                        filter.idate = {};
                    }
                    filter.idate.$lte = dateend;
                    mailboxNeeded = true;
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
                    mailboxNeeded = true;
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
                    mailboxNeeded = true;
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
                    mailboxNeeded = true;
                }

                if (filterAttachments) {
                    filter.ha = true;
                    mailboxNeeded = true;
                }

                let handleMailbox = done => {
                    if (!mailboxNeeded || mailbox) {
                        return done();
                    }
                    db.database
                        .collection('mailboxes')
                        .find({ user })
                        .project({
                            _id: true
                        })
                        .toArray((err, mailboxes) => {
                            if (err) {
                                res.json({
                                    error: 'MongoDB Error: ' + err.message
                                });
                                return next();
                            }
                            filter.mailbox = { $in: mailboxes.map(m => m._id) };
                            done();
                        });
                };

                handleMailbox(() => {
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
                                results: (result.results || []).map(formatMessageListing)
                            };

                            res.json(response);
                            return next();
                        });
                    });
                });
            }
        );
    });

    /**
     * @api {get} /users/:user/mailboxes/:mailbox/messages/:message Request Message information
     * @apiName GetMessage
     * @apiGroup Messages
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} message ID of the Message
     * @apiParam {Boolean} [markAsSeen=false] If true then marks message as seen
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Number} id ID of the Message
     * @apiSuccess {String} mailbox ID of the Mailbox
     * @apiSuccess {String} user ID of the User
     * @apiSuccess {Object} from From: header info
     * @apiSuccess {Object} from.name Name of the sender
     * @apiSuccess {Object} from.address Address of the sender
     * @apiSuccess {Object[]} to To: header info
     * @apiSuccess {Object} to.name Name of the recipient
     * @apiSuccess {Object} to.address Address of the recipient
     * @apiSuccess {Object[]} cc Cc: header info
     * @apiSuccess {Object} cc.name Name of the recipient
     * @apiSuccess {Object} cc.address Address of the recipient
     * @apiSuccess {String} subject Message subject
     * @apiSuccess {String} messageId Message-ID header
     * @apiSuccess {String} date Datestring of message header
     * @apiSuccess {Object} list If set then this message is from a mailing list
     * @apiSuccess {String} list.id Value from List-ID header
     * @apiSuccess {String} list.unsubscribe Value from List-Unsubscribe header
     * @apiSuccess {String} expires Datestring, if set then indicates the time after this message is automatically deleted
     * @apiSuccess {Boolean} seen Does this message have a \Seen flag
     * @apiSuccess {Boolean} deleted Does this message have a \Deleted flag
     * @apiSuccess {Boolean} flagged Does this message have a \Flagged flag
     * @apiSuccess {Boolean} draft Does this message have a \Draft flag
     * @apiSuccess {String[]} html An array of HTML string. Every array element is from a separate mime node, usually you would just join these to a single string
     * @apiSuccess {String} text Plaintext content of the message
     * @apiSuccess {Object[]} attachments List of attachments for this message
     * @apiSuccess {String} attachments.id Attachment ID
     * @apiSuccess {String} attachments.filename Filename of the attachment
     * @apiSuccess {String} attachments.contentType MIME type
     * @apiSuccess {String} attachments.disposition Attachment disposition
     * @apiSuccess {String} attachments.transferEncoding Which transfer encoding was used (actual content when fetching attachments is not encoded)
     * @apiSuccess {Boolean} attachments.related Was this attachment found from a multipart/related node. This usually means that this is an embedded image
     * @apiSuccess {Number} attachments.sizeKb Approximate size of the attachment in kilobytes
     * @apiSuccess {Object} contentType Parsed Content-Type header. Usually needed to identify encrypted messages and such
     * @apiSuccess {String} contentType.value MIME type of the message, eg. "multipart/mixed"
     * @apiSuccess {Object} contentType.params An object with Content-Type params as key-value pairs
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": 1,
     *       "mailbox": "59fc66a03e54454869460e46",
     *       "user": "59fc66a03e54454869460e45",
     *       "from": {
     *         "address": "rfinnie@domain.dom",
     *         "name": "Ryan Finnie"
     *       },
     *       "to": [
     *         {
     *           "address": "bob@domain.dom",
     *           "name": ""
     *         }
     *       ],
     *       "subject": "Ryan Finnie's MIME Torture Test v1.0",
     *       "messageId": "<1066976914.4721.5.camel@localhost>",
     *       "date": "2003-10-24T06:28:34.000Z",
     *       "seen": true,
     *       "deleted": false,
     *       "flagged": true,
     *       "draft": false,
     *       "html": [
     *         "<p>Welcome to Ryan Finnie&apos;s MIME torture test.</p>",
     *         "<p>While a message/rfc822 part inside another message/rfc822 part in a<br/>message isn&apos;t too strange, 200 iterations of that would be.</p>"
     *       ],
     *       "text": "Welcome to Ryan Finnie's MIME torture test. This message was designed\nto introduce a couple of the newer features of MIME-aware MUA",
     *       "attachments": [
     *         {
     *           "id": "ATT00004",
     *           "filename": "foo.gz",
     *           "contentType": "application/x-gzip",
     *           "disposition": "attachment",
     *           "transferEncoding": "base64",
     *           "related": false,
     *           "sizeKb": 1
     *         },
     *         {
     *           "id": "ATT00007",
     *           "filename": "blah1.gz",
     *           "contentType": "application/x-gzip",
     *           "disposition": "attachment",
     *           "transferEncoding": "base64",
     *           "related": false,
     *           "sizeKb": 1
     *         }
     *       ],
     *       "contentType": {
     *         "value": "multipart/mixed",
     *         "params": {
     *           "boundary": "=-qYxqvD9rbH0PNeExagh1"
     *         }
     *       }
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
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

        db.database.collection('messages').findOne(
            {
                mailbox,
                uid: message
            },
            {
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
                    html: true,
                    text: true,
                    textFooter: true,
                    forwardTargets: true
                }
            },
            (err, messageData) => {
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

                messageData.text = (messageData.text || '') + (messageData.textFooter || '');

                if (replaceCidLinks) {
                    messageData.html = (messageData.html || []).map(html =>
                        html.replace(/attachment:([a-f0-9]+)\/(ATT\d+)/g, (str, mid, aid) =>
                            server.router.render('attachment', { user, mailbox, message, attachment: aid })
                        )
                    );

                    messageData.text = messageData.text.replace(/attachment:([a-f0-9]+)\/(ATT\d+)/g, (str, mid, aid) =>
                        server.router.render('attachment', { user, mailbox, message, attachment: aid })
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
                        mailbox,
                        user,
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
                        text: messageData.text,
                        forwardTargets: messageData.forwardTargets,
                        attachments: messageData.attachments || []
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
            }
        );
    });

    /**
     * @api {get} /users/:user/mailboxes/:mailbox/messages/:message/events Message events
     * @apiName GetMessageEvents
     * @apiGroup Messages
     * @apiDescription This method returns a listing of events related to this messages. This includes how the message was received and also information about forwarding
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} message ID of the Message
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} events List of events
     * @apiSuccess {String} action Event type
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1/events"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59fc66a03e54454869460e4e",
     *       "events": [
     *         {
     *           "id": "59fc66a03e54454869460e4e",
     *           "stored": "59fc66a03e54454869460e4e",
     *           "action": "STORE",
     *           "origin": "Import",
     *           "messageId": "<1066976914.4721.5.camel@localhost>",
     *           "from": null,
     *           "to": [
     *             "user1@example.com"
     *           ],
     *           "transtype": null,
     *           "time": 1509713568834
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

        db.database.collection('messages').findOne(
            {
                mailbox,
                uid: message
            },
            {
                fields: {
                    _id: true,
                    msgid: true,
                    user: true,
                    mailbox: true,
                    uid: true,
                    meta: true,
                    outbound: true
                }
            },
            (err, messageData) => {
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
                            $or: [{ id: messageData.outbound[0] }, { parentId: messageData._id }]
                        };
                    } else if (messageData.outbound && messageData.outbound.length > 1) {
                        logQuery = {
                            $or: [{ id: { $in: messageData.outbound } }, { parentId: messageData._id }]
                        };
                    } else {
                        logQuery = {
                            parentId: messageData._id
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
                                    stored: entry.parentId,
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
            }
        );
    });

    /**
     * @api {get} /users/:user/mailboxes/:mailbox/messages/:message/message.eml Get Message source
     * @apiName GetMessageSource
     * @apiGroup Messages
     * @apiDescription This method returns the full RFC822 formatted source of the stored message
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} message ID of the Message
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1/message.eml"
     *
     * @apiSuccessExample {text} Success-Response:
     *     HTTP/1.1 200 OK
     *     Content-Type: message/rfc822
     *
     *     Subject: Ryan Finnie's MIME Torture Test v1.0
     *     From: Ryan Finnie <rfinnie@domain.dom>
     *     To: bob@domain.dom
     *     Content-Type: multipart/mixed; boundary="=-qYxqvD9rbH0PNeExagh1"
     *     ...
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
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

        db.database.collection('messages').findOne(
            {
                mailbox,
                uid: message
            },
            {
                fields: {
                    _id: true,
                    user: true,
                    mimeTree: true
                }
            },
            (err, messageData) => {
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
            }
        );
    });

    /**
     * @api {get} /users/:user/mailboxes/:mailbox/messages/:message/attachments/:attachment Download Attachment
     * @apiName GetMessageAttachment
     * @apiGroup Messages
     * @apiDescription This method returns attachment file contents in binary form
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} message ID of the Message
     * @apiParam {String} attachment ID of the Attachment
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/1/attachments/ATT00002"
     *
     * @apiSuccessExample {text} Success-Response:
     *     HTTP/1.1 200 OK
     *     Content-Type: image/png
     *
     *     <89>PNG...
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This attachment does not exist"
     *     }
     */
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

        db.database.collection('messages').findOne(
            {
                mailbox,
                uid: message,
                user
            },
            {
                fields: {
                    _id: true,
                    user: true,
                    attachments: true,
                    'mimeTree.attachmentMap': true
                }
            },
            (err, messageData) => {
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
            }
        );
    });

    /**
     * @api {put} /users/:user/mailboxes/:mailbox/messages/:message Update Message information
     * @apiName PutMessage
     * @apiGroup Messages
     * @apiDescription This method updates message flags and also allows to move messages to a different mailbox
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {String} message Message ID values. Either comma separated numbers (1,2,3) or colon separated range (3:15)
     * @apiParam {String} moveTo ID of the target Mailbox if you want to move messages
     * @apiParam {Boolean} seen State of the \Seen flag
     * @apiParam {Boolean} flagged State of the \Flagged flag
     * @apiParam {Boolean} draft State of the \Draft flag
     * @apiParam {Datestring} expires Either expiration date or <code>false</code> to turn of autoexpiration
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} id If messages were moved then lists new ID values. Array entry is an array with first element pointing to old ID and second to new ID
     * @apiSuccess {Number} updated If messages were not moved, then indicates the number of updated messages
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Mark messages as unseen:
     *     curl -i -XPUT "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1,2,3" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "seen": false
     *     }'
     *
     * @apiSuccessExample {json} Update Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "updated": 2
     *     }
     *
     * @apiSuccessExample {json} Move Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "mailbox": "59fc66a13e54454869460e57",
     *       "id": [
     *         [1,24],
     *         [2,25]
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
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

    /**
     * @api {delete} /users/:user/mailboxes/:mailbox/messages/:message Delete a Message
     * @apiName DeleteMessage
     * @apiGroup Messages
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} message Message ID
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Delete a Message:
     *     curl -i -XDELETE "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/2"
     *
     * @apiSuccessExample {json} Delete Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
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

        db.database.collection('messages').findOne(
            {
                mailbox,
                uid: message
            },
            (err, messageData) => {
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
                        messageData,
                        archive: !messageData.flags.includes('\\Draft')
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
            }
        );
    });

    /**
     * @api {post} /users/:user/mailboxes/:mailbox/messages Upload Message Source
     * @apiName UploadMessage
     * @apiGroup Messages
     * @apiDescription This method allows to upload an RFC822 formatted message to a mailbox. Message
     * is stored unmodified, no headers are added or removed.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Boolean} [unseen=false] Is the message unseen or not
     * @apiParam {Boolean} [draft=false] Is the message a draft or not
     * @apiParam {Boolean} [flagged=false] Is the message flagged or not
     * @apiParam {String} raw base64 encoded message source. Alternatively, you can provide this value as POST body by using message/rfc822 MIME type
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object} message Message information
     * @apiSuccess {Number} message.id Message ID in mailbox
     * @apiSuccess {String} message.mailbox Mailbox ID the message was stored into
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Delete a Message:
     *     curl -i -XPOST "http://localhost:8080/users/5a2f9ca57308fc3a6f5f811d/mailboxes/5a2f9ca57308fc3a6f5f811e/messages" \
     *     -H 'Content-type: message/rfc822' \
     *     -d 'From: sender@example.com
     *     To: recipient@example.com
     *     Subject: hello world!
     *
     *     Example message'
     *
     * @apiSuccessExample {json} Forward Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "message": {
     *         "id": 2,
     *         "mailbox": "5a2f9ca57308fc3a6f5f811e"
     *       }
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.post('/users/:user/mailboxes/:mailbox/messages', (req, res, next) => {
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
            date: Joi.date(),
            unseen: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
            flagged: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
            draft: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
            raw: Joi.binary()
                .max(consts.MAX_ALLOWE_MESSAGE_SIZE)
                .required(),
            sess: Joi.string().max(255),
            ip: Joi.string().ip({
                version: ['ipv4', 'ipv6'],
                cidr: 'forbidden'
            })
        });

        Object.keys(req.query || {}).forEach(key => {
            if (!(key in req.params)) {
                req.params[key] = req.query[key];
            }
        });
        req.params.raw = req.params.raw || req.body;

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
        let raw = result.value.raw;
        let date = result.value.date || new Date();

        db.database.collection('mailboxes').findOne(
            {
                _id: mailbox,
                user
            },
            (err, mailboxData) => {
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

                db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    (err, userData) => {
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

                        if (userData.quota && userData.storageUsed > userData.quota) {
                            res.json({
                                error: 'User is over quota',
                                code: 'OVERQUOTA'
                            });
                            return next();
                        }

                        messageHandler.encryptMessage(userData.encryptMessages ? userData.pubKey : false, raw, (err, encrypted) => {
                            if (!err && encrypted) {
                                raw = encrypted;
                            }
                            messageHandler.add(
                                {
                                    user,
                                    mailbox: mailboxData,
                                    meta: {
                                        source: 'API',
                                        from: '',
                                        origin: result.value.ip || '127.0.0.1',
                                        transtype: 'UPLOAD',
                                        time: date
                                    },
                                    session: result.value.session,
                                    date,
                                    flags: []
                                        .concat('unseen' in result.value ? (result.value.unseen ? [] : '\\Seen') : [])
                                        .concat('flagged' in result.value ? (result.value.flagged ? '\\Flagged' : []) : [])
                                        .concat('draft' in result.value ? (result.value.draft ? '\\Draft' : []) : []),
                                    raw
                                },
                                (err, status, data) => {
                                    if (err) {
                                        if (err.imapResponse) {
                                            res.json({
                                                error: err.message,
                                                code: err.imapResponse
                                            });
                                        } else {
                                            res.json({
                                                error: err.message,
                                                code: err.imapResponse
                                            });
                                        }
                                        return next();
                                    }
                                    res.json({
                                        success: status,
                                        message: data
                                            ? {
                                                id: data.uid,
                                                mailbox: data.mailbox
                                            }
                                            : false
                                    });
                                    return next();
                                }
                            );
                        });
                    }
                );
            }
        );
    });

    /**
     * @api {post} /users/:user/mailboxes/:mailbox/messages/:message/forward Forward stored Message
     * @apiName DeleteMessage
     * @apiGroup Messages
     * @apiDescription This method allows either to re-forward a message to an original forward target
     * or forward it to some other address. This is useful if an user had forwarding turned on but the
     * message was not delivered so you can try again. Forwarding does not modify the original message.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} message Message ID
     * @apiParam {Number} [target] Number of original forwarding target
     * @apiParam {String[]} [addresses] An array of additional forward targets
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} queueId Message ID in outbound queue
     * @apiSuccess {Object[]} forwarded Information about forwarding targets
     * @apiSuccess {String} forwarded.seq Sequence ID
     * @apiSuccess {String} forwarded.type Target type
     * @apiSuccess {String} forwarded.value Target address
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Delete a Message:
     *     curl -i -XPOST "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/1/forward" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "addresses": [
     *         "andris@ethereal.email"
     *       ]
     *     }'
     *
     * @apiSuccessExample {json} Forward Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "1600d2f36470008b72",
     *       "forwarded": [
     *         {
     *           "seq": "001",
     *           "type": "mail",
     *           "value": "andris@ethereal.email"
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
    server.post('/users/:user/mailboxes/:mailbox/messages/:message/forward', (req, res, next) => {
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
            message: Joi.number().required(),
            target: Joi.number()
                .min(1)
                .max(1000),
            addresses: Joi.array().items(Joi.string().email())
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

        db.database.collection('messages').findOne(
            {
                mailbox,
                uid: message
            },
            {
                fields: {
                    _id: true,
                    mailbox: true,
                    user: true,
                    uid: true,
                    'meta.from': true,
                    'meta.to': true,
                    mimeTree: true,
                    forwardTargets: true
                }
            },
            (err, messageData) => {
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

                let forwardTargets = [];

                [].concat(result.value.addresses || []).forEach(address => {
                    forwardTargets.push({ type: 'mail', value: address });
                });

                if (messageData.forwardTargets) {
                    if (result.value.target) {
                        forwardTargets = forwardTargets.concat(messageData.forwardTargets[result.value.target - 1] || []);
                    } else if (!forwardTargets.length) {
                        forwardTargets = messageData.forwardTargets;
                    }
                }

                if (!forwardTargets || !forwardTargets.length) {
                    res.json({
                        success: true,
                        forwarded: []
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

                let forwardData = {
                    parentId: messageData._id,
                    sender: messageData.meta.from,
                    recipient: messageData.meta.to,
                    targets: forwardTargets,
                    stream: response.value
                };

                forward(forwardData, (err, queueId) => {
                    if (err) {
                        log.error(
                            'API',
                            '%s FRWRDFAIL from=%s to=%s target=%s error=%s',
                            forwardData.parentId.toString(),
                            forwardData.sender,
                            forwardData.recipient,
                            forwardTargets.map(target => (typeof target.value === 'string' ? target.value : 'relay')).join(','),
                            err.message
                        );
                    } else if (queueId) {
                        log.silly(
                            'API',
                            '%s FRWRDOK id=%s from=%s to=%s target=%s',
                            forwardData.parentId.toString(),
                            queueId,
                            forwardData.sender,
                            forwardData.recipient,
                            forwardTargets.map(target => (typeof target.value === 'string' ? target.value : 'relay')).join(',')
                        );
                    }

                    return db.database.collection('messages').findOneAndUpdate(
                        {
                            _id: messageData._id,
                            mailbox: messageData.mailbox,
                            uid: messageData.uid
                        },
                        {
                            $addToSet: {
                                outbound: queueId
                            }
                        },
                        {
                            returnOriginal: true,
                            projection: {
                                _id: true,
                                outbound: true
                            }
                        },
                        () => {
                            res.json({
                                success: true,
                                queueId,
                                forwarded: forwardTargets.map((target, i) => ({
                                    seq: leftPad((i + 1).toString(16), '0', 3),
                                    type: target.type,
                                    value: target.value
                                }))
                            });
                            return next();
                        }
                    );
                });
            }
        );
    });

    /**
     * @api {get} /users/:user/archived List archived messages
     * @apiName GetArchivedMessages
     * @apiGroup Archive
     * @apiDescription Archive contains all recently deleted messages besides Drafts etc.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {Number} [limit=20] How many records to return
     * @apiParam {Number} [page=1] Current page number. Informational only, page numbers start from 1
     * @apiParam {Number} [order="desc"] Ordering of the records by insert date
     * @apiParam {Number} [next] Cursor value for next page, retrieved from <code>nextCursor</code> response value
     * @apiParam {Number} [previous] Cursor value for previous page, retrieved from <code>previousCursor</code> response value
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Number} total How many results were found
     * @apiSuccess {Number} page Current page number. Derived from <code>page</code> query argument
     * @apiSuccess {String} previousCursor Either a cursor string or false if there are not any previous results
     * @apiSuccess {String} nextCursor Either a cursor string or false if there are not any next results
     * @apiSuccess {Object[]} results Message listing
     * @apiSuccess {String} results.id ID of the Message (24 byte hex)
     * @apiSuccess {String} results.mailbox ID of the Mailbox
     * @apiSuccess {String} results.thread ID of the Thread
     * @apiSuccess {Object} results.from Sender info
     * @apiSuccess {String} results.from.name Name of the sender
     * @apiSuccess {String} results.from.address Address of the sender
     * @apiSuccess {String} results.subject Message subject
     * @apiSuccess {String} results.date Datestring
     * @apiSuccess {String} results.intro First 128 bytes of the message
     * @apiSuccess {Boolean} results.attachments Does the message have attachments
     * @apiSuccess {Boolean} results.seen Is this message alread seen or not
     * @apiSuccess {Boolean} results.deleted Does this message have a \Deleted flag (should not have as messages are automatically deleted once this flag is set)
     * @apiSuccess {Boolean} results.flagged Does this message have a \Flagged flag
     * @apiSuccess {Object} results.contentType Parsed Content-Type header. Usually needed to identify encrypted messages and such
     * @apiSuccess {String} results.contentType.value MIME type of the message, eg. "multipart/mixed"
     * @apiSuccess {Object} results.contentType.params An object with Content-Type params as key-value pairs
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/archived"
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
     *           "id": "59fc66a13e54454869460e58",
     *           "mailbox": "59fc66a03e54454869460e46",
     *           "thread": "59fc66a13e54454869460e50",
     *           "from": {
     *             "address": "rfinnie@domain.dom",
     *             "name": "Ryan Finnie"
     *           },
     *           "subject": "Ryan Finnie's MIME Torture Test v1.0",
     *           "date": "2003-10-24T06:28:34.000Z",
     *           "intro": "Welcome to Ryan Finnie's MIME torture test. This message was designed to introduce a couple of the newer features of MIME-aware…",
     *           "attachments": true,
     *           "seen": true,
     *           "deleted": false,
     *           "flagged": true,
     *           "draft": false,
     *           "url": "/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages/1",
     *           "contentType": {
     *             "value": "multipart/mixed",
     *             "params": {
     *               "boundary": "=-qYxqvD9rbH0PNeExagh1"
     *             }
     *           }
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
    server.get({ name: 'archived', path: '/users/:user/archived' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            limit: Joi.number()
                .empty('')
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
            order: Joi.any()
                .empty('')
                .allow(['asc', 'desc'])
                .default('desc'),
            page: Joi.number()
                .empty('')
                .default(1)
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
        let pagePrevious = result.value.previous;
        let sortAscending = result.value.order === 'asc';

        getArchivedMessageCount(db, user, (err, total) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            let opts = {
                limit,
                query: { user },
                fields: {
                    _id: true,
                    mailbox: true,
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
                paginatedField: '_id',
                sortAscending
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrevious) {
                opts.previous = pagePrevious;
            }

            MongoPaging.find(db.database.collection('archived'), opts, (err, result) => {
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
                    results: (result.results || [])
                        .map(m => {
                            // prepare message for output
                            m.uid = m._id;
                            return m;
                        })
                        .map(formatMessageListing)
                };

                res.json(response);
                return next();
            });
        });
    });

    /**
     * @api {get} /users/:user/archived/:message Request Archived Message
     * @apiName GetArchivedMessage
     * @apiGroup Archive
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {Number} message ID of the Message
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Message
     * @apiSuccess {String} mailbox ID of the Mailbox the messages was deleted from
     * @apiSuccess {String} user ID of the User
     * @apiSuccess {Object} from From: header info
     * @apiSuccess {Object} from.name Name of the sender
     * @apiSuccess {Object} from.address Address of the sender
     * @apiSuccess {Object[]} to To: header info
     * @apiSuccess {Object} to.name Name of the recipient
     * @apiSuccess {Object} to.address Address of the recipient
     * @apiSuccess {Object[]} cc Cc: header info
     * @apiSuccess {Object} cc.name Name of the recipient
     * @apiSuccess {Object} cc.address Address of the recipient
     * @apiSuccess {String} subject Message subject
     * @apiSuccess {String} messageId Message-ID header
     * @apiSuccess {String} date Datestring of message header
     * @apiSuccess {Object} list If set then this message is from a mailing list
     * @apiSuccess {String} list.id Value from List-ID header
     * @apiSuccess {String} list.unsubscribe Value from List-Unsubscribe header
     * @apiSuccess {String} expires Datestring, if set then indicates the time after this message is automatically deleted
     * @apiSuccess {Boolean} seen Does this message have a \Seen flag
     * @apiSuccess {Boolean} deleted Does this message have a \Deleted flag
     * @apiSuccess {Boolean} flagged Does this message have a \Flagged flag
     * @apiSuccess {Boolean} draft Does this message have a \Draft flag
     * @apiSuccess {String[]} html An array of HTML string. Every array element is from a separate mime node, usually you would just join these to a single string
     * @apiSuccess {String} text Plaintext content of the message
     * @apiSuccess {Object[]} attachments List of attachments for this message
     * @apiSuccess {String} attachments.id Attachment ID
     * @apiSuccess {String} attachments.filename Filename of the attachment
     * @apiSuccess {String} attachments.contentType MIME type
     * @apiSuccess {String} attachments.disposition Attachment disposition
     * @apiSuccess {String} attachments.transferEncoding Which transfer encoding was used (actual content when fetching attachments is not encoded)
     * @apiSuccess {Boolean} attachments.related Was this attachment found from a multipart/related node. This usually means that this is an embedded image
     * @apiSuccess {Number} attachments.sizeKb Approximate size of the attachment in kilobytes
     * @apiSuccess {Object} contentType Parsed Content-Type header. Usually needed to identify encrypted messages and such
     * @apiSuccess {String} contentType.value MIME type of the message, eg. "multipart/mixed"
     * @apiSuccess {Object} contentType.params An object with Content-Type params as key-value pairs
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/archived/59fc66a13e54454869460e58"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59fc66a13e54454869460e58",
     *       "mailbox": "59fc66a03e54454869460e46",
     *       "user": "59fc66a03e54454869460e45",
     *       "from": {
     *         "address": "rfinnie@domain.dom",
     *         "name": "Ryan Finnie"
     *       },
     *       "to": [
     *         {
     *           "address": "bob@domain.dom",
     *           "name": ""
     *         }
     *       ],
     *       "subject": "Ryan Finnie's MIME Torture Test v1.0",
     *       "messageId": "<1066976914.4721.5.camel@localhost>",
     *       "date": "2003-10-24T06:28:34.000Z",
     *       "seen": true,
     *       "deleted": false,
     *       "flagged": true,
     *       "draft": false,
     *       "html": [
     *         "<p>Welcome to Ryan Finnie&apos;s MIME torture test.</p>",
     *         "<p>While a message/rfc822 part inside another message/rfc822 part in a<br/>message isn&apos;t too strange, 200 iterations of that would be.</p>"
     *       ],
     *       "text": "Welcome to Ryan Finnie's MIME torture test. This message was designed\nto introduce a couple of the newer features of MIME-aware MUA",
     *       "attachments": [
     *         {
     *           "id": "ATT00004",
     *           "filename": "foo.gz",
     *           "contentType": "application/x-gzip",
     *           "disposition": "attachment",
     *           "transferEncoding": "base64",
     *           "related": false,
     *           "sizeKb": 1
     *         },
     *         {
     *           "id": "ATT00007",
     *           "filename": "blah1.gz",
     *           "contentType": "application/x-gzip",
     *           "disposition": "attachment",
     *           "transferEncoding": "base64",
     *           "related": false,
     *           "sizeKb": 1
     *         }
     *       ],
     *       "contentType": {
     *         "value": "multipart/mixed",
     *         "params": {
     *           "boundary": "=-qYxqvD9rbH0PNeExagh1"
     *         }
     *       }
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.get({ name: 'archived_message', path: '/users/:user/archived/:message' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            replaceCidLinks: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false)
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
        let message = new ObjectID(result.value.message);
        let replaceCidLinks = result.value.replaceCidLinks;

        db.database.collection('archived').findOne(
            {
                _id: message,
                user
            },
            {
                fields: {
                    _id: true,
                    mailbox: true,
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
                    html: true,
                    text: true,
                    textFooter: true,
                    forwardTargets: true
                }
            },
            (err, messageData) => {
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

                messageData.text = (messageData.text || '') + (messageData.textFooter || '');

                if (replaceCidLinks) {
                    messageData.html = (messageData.html || []).map(html =>
                        html.replace(/attachment:([a-f0-9]+)\/(ATT\d+)/g, (str, mid, aid) =>
                            server.router.render('archived_attachment', { user, message, attachment: aid })
                        )
                    );

                    messageData.text = messageData.text.replace(/attachment:([a-f0-9]+)\/(ATT\d+)/g, (str, mid, aid) =>
                        server.router.render('archived_attachment', { user, message, attachment: aid })
                    );
                }

                let response = {
                    success: true,
                    id: message,
                    mailbox: messageData.mailbox,
                    user,
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
                    text: messageData.text,
                    forwardTargets: messageData.forwardTargets,
                    attachments: messageData.attachments || []
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
            }
        );
    });

    /**
     * @api {get} /users/:user/archived/:message/attachments/:attachment Download Archived Attachment
     * @apiName GetArchivedAttachment
     * @apiGroup Archive
     * @apiDescription This method returns attachment file contents in binary form
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {Number} message ID of the Archived Message
     * @apiParam {String} attachment ID of the Attachment
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/archived/59fc66a13e54454869460e58/attachments/ATT00003"
     *
     * @apiSuccessExample {text} Success-Response:
     *     HTTP/1.1 200 OK
     *     Content-Type: image/png
     *
     *     <89>PNG...
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This attachment does not exist"
     *     }
     */
    server.get({ name: 'archived_attachment', path: '/users/:user/archived/:message/attachments/:attachment' }, (req, res, next) => {
        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
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
        let message = new ObjectID(result.value.message);
        let attachment = result.value.attachment;

        db.database.collection('archived').findOne(
            {
                user,
                _id: message
            },
            {
                fields: {
                    _id: true,
                    user: true,
                    attachments: true,
                    'mimeTree.attachmentMap': true
                }
            },
            (err, messageData) => {
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
            }
        );
    });

    /**
     * @api {post} /users/:user/archived/:message/restore Restore archived Message
     * @apiName RestoreMessage
     * @apiGroup Archive
     * @apiDescription Restores an archived message by moving it back to the mailbox it
     * was deleted from or to provided target mailbox. If target mailbox does not exist, then
     * the message is moved to INBOX.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {Number} message Message ID
     * @apiParam {String} [mailbox] ID of the target Mailbox. If not set then original mailbox is used.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} mailbox Maibox ID the message was moved to
     * @apiSuccess {Number} id New ID for the Message
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Restore a Message:
     *     curl -i -XPOST "http://localhost:8080/users/59fc66a03e54454869460e45/archived/59fc66a13e54454869460e58/restore" \
     *     -H 'Content-type: application/json' \
     *     -d '{}'
     *
     * @apiSuccessExample {json} Restore Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "mailbox": "59fc66a13e54454869460e57",
     *       "id": 4
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.post({ name: 'archived_restore', path: '/users/:user/archived/:message/restore' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            message: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            mailbox: Joi.string()
                .hex()
                .lowercase()
                .length(24)
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
        let message = new ObjectID(result.value.message);
        let mailbox = result.value.mailbox ? new ObjectID(result.value.mailbox) : false;

        db.database.collection('archived').findOne(
            {
                _id: message,
                user
            },
            (err, messageData) => {
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

                messageData.mailbox = mailbox || messageData.mailbox;
                delete messageData.archived;
                delete messageData.exp;
                delete messageData.rdate;

                messageHandler.put(messageData, (err, response) => {
                    if (err) {
                        res.json({
                            error: err.message
                        });
                    } else if (!response) {
                        res.json({
                            succese: false,
                            error: 'Failed to restore message'
                        });
                    } else {
                        response.success = true;
                        res.json({
                            success: true,
                            mailbox: response.mailbox,
                            id: response.uid
                        });
                        return db.database.collection('archived').deleteOne({ _id: messageData._id }, () => next());
                    }
                    return next();
                });
            }
        );
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

function getArchivedMessageCount(db, user, done) {
    db.database.collection('archived').count({ user }, (err, total) => {
        if (err) {
            return done(err);
        }
        done(null, total);
    });
}

function leftPad(val, chr, len) {
    return chr.repeat(len - val.toString().length) + val;
}

function formatMessageListing(messageData) {
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
        draft: messageData.draft
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
}
