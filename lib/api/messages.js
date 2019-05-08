'use strict';

const config = require('wild-config');
const log = require('npmlog');
const libmime = require('libmime');
const Joi = require('../joi');
const uuid = require('uuid');
const os = require('os');
const MongoPaging = require('mongo-cursor-pagination');
const addressparser = require('nodemailer/lib/addressparser');
const MailComposer = require('nodemailer/lib/mail-composer');
const htmlToText = require('html-to-text');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const consts = require('../consts');
const libbase64 = require('libbase64');
const libqp = require('libqp');
const forward = require('../forward');
const Maildropper = require('../maildropper');
const util = require('util');
const roles = require('../roles');

module.exports = (db, server, messageHandler, userHandler, storageHandler) => {
    let maildrop = new Maildropper({
        db,
        zone: config.sender.zone,
        collection: config.sender.collection,
        gfs: config.sender.gfs
    });

    const putMessage = util.promisify(messageHandler.put.bind(messageHandler));
    const updateMessage = util.promisify(messageHandler.update.bind(messageHandler));
    const deleteMessage = util.promisify(messageHandler.del.bind(messageHandler));

    const encryptMessage = util.promisify(messageHandler.encryptMessage.bind(messageHandler));
    const getAttachmentData = util.promisify(messageHandler.attachmentStorage.get.bind(messageHandler.attachmentStorage));

    const getMailboxCounter = util.promisify(tools.getMailboxCounter);
    const asyncForward = util.promisify(forward);

    const addMessage = util.promisify((...args) => {
        let callback = args.pop();
        messageHandler.add(...args, (err, status, data) => {
            if (err) {
                return callback(err);
            }
            return callback(null, { status, data });
        });
    });

    const moveMessage = util.promisify((...args) => {
        let callback = args.pop();
        messageHandler.move(...args, (err, result, info) => {
            if (err) {
                return callback(err);
            }
            return callback(null, { result, info });
        });
    });

    const putMessageHandler = async (req, res, next) => {
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
                .regex(/^\d+(,\d+)*$|^\d+:\d+$/i)
                .required(),
            seen: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
            deleted: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
            flagged: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
            draft: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
            expires: Joi.alternatives().try(
                Joi.date(),
                Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .allow(false)
            ),
            metaData: Joi.string()
                .empty('')
                .trim()
                .max(1024 * 1024),
            sess: Joi.string().max(255),
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        if (result.value.metaData) {
            try {
                let value = JSON.parse(result.value.metaData);
                if (!value || typeof value !== 'object') {
                    throw new Error('Not an object');
                }
            } catch (err) {
                res.json({
                    error: 'metaData value must be valid JSON object string',
                    code: 'InputValidationError'
                });
                return next();
            }
        }

        // permissions check
        if (req.user && req.user === result.value.user) {
            req.validate(roles.can(req.role).updateOwn('messages'));
        } else {
            req.validate(roles.can(req.role).updateAny('messages'));
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
                error: 'Invalid message identifier',
                code: 'MessageNotFound'
            });
            return next();
        }

        if (moveTo) {
            let info;
            try {
                let data = await moveMessage({
                    user,
                    source: { user, mailbox },
                    destination: { user, mailbox: moveTo },
                    updates: result.value,
                    messageQuery
                });
                info = data.info;
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (!info || !info.destinationUid || !info.destinationUid.length) {
                res.json({
                    error: 'Could not move message, check if message exists',
                    code: 'MessageNotFound'
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

        let updated;
        try {
            updated = await updateMessage(user, mailbox, messageQuery, result.value);
        } catch (err) {
            res.json({
                error: err.message,
                code: err.code
            });
            return next();
        }

        if (!updated) {
            res.json({
                error: 'No message matched query',
                code: 'MessageNotFound'
            });
            return next();
        }

        res.json({
            success: true,
            updated
        });
        return next();
    };

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
     * @apiParam {Number} [unseen=false] If true, then returns only unseen messages
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
     * @apiSuccess {Object[]} results.to Recipients in To: field
     * @apiSuccess {String} results.to.name Name of the recipient
     * @apiSuccess {String} results.to.address Address of the recipient
     * @apiSuccess {Object[]} results.cc Recipients in Cc: field
     * @apiSuccess {String} results.cc.name Name of the recipient
     * @apiSuccess {String} results.cc.address Address of the recipient
     * @apiSuccess {Object[]} results.bcc Recipients in Bcc: field. Usually only available for drafts
     * @apiSuccess {String} results.bcc.name Name of the recipient
     * @apiSuccess {String} results.bcc.address Address of the recipient
     * @apiSuccess {String} results.subject Message subject
     * @apiSuccess {String} results.date Datestring
     * @apiSuccess {String} results.intro First 128 bytes of the message
     * @apiSuccess {Boolean} results.attachments Does the message have attachments
     * @apiSuccess {Boolean} results.seen Is this message alread seen or not
     * @apiSuccess {Boolean} results.deleted Does this message have a \\Deleted flag (should not have as messages are automatically deleted once this flag is set)
     * @apiSuccess {Boolean} results.flagged Does this message have a \\Flagged flag
     * @apiSuccess {Boolean} results.answered Does this message have a \\Answered flag
     * @apiSuccess {Boolean} results.forwarded Does this message have a \$Forwarded flag
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
     *           "answered": false,
     *           "forwarded": false,
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
    server.get(
        { name: 'messages', path: '/users/:user/mailboxes/:mailbox/messages' },
        tools.asyncifyJson(async (req, res, next) => {
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
                unseen: Joi.boolean()
                    .empty('')
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
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
                    .default(1),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;
            let sortAscending = result.value.order === 'asc';
            let filterUnseen = result.value.unseen;

            let mailboxData;
            try {
                mailboxData = await db.database.collection('mailboxes').findOne(
                    {
                        _id: mailbox,
                        user
                    },
                    {
                        projection: {
                            path: true,
                            specialUse: true,
                            uidNext: true
                        }
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!mailboxData) {
                res.json({
                    error: 'This mailbox does not exist',
                    code: 'NoSuchMailbox'
                });
                return next();
            }

            let filter = {
                mailbox
            };

            if (filterUnseen) {
                filter.unseen = true;
            }

            let total = await getFilteredMessageCount(filter);

            let opts = {
                limit,
                query: filter,
                fields: {
                    idate: true,
                    // FIXME: MongoPaging inserts fields value as second argument to col.find()
                    projection: {
                        _id: true,
                        uid: true,
                        msgid: true,
                        mailbox: true,
                        'meta.from': true,
                        hdate: true,
                        idate: true,
                        subject: true,
                        'mimeTree.parsedHeader.from': true,
                        'mimeTree.parsedHeader.sender': true,
                        'mimeTree.parsedHeader.to': true,
                        'mimeTree.parsedHeader.cc': true,
                        'mimeTree.parsedHeader.bcc': true,
                        'mimeTree.parsedHeader.content-type': true,
                        'mimeTree.parsedHeader.references': true,
                        ha: true,
                        intro: true,
                        unseen: true,
                        undeleted: true,
                        flagged: true,
                        draft: true,
                        thread: true,
                        flags: true
                    }
                },
                paginatedField: 'idate',
                sortAscending
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.database.collection('messages'), opts);
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let response = {
                success: true,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                specialUse: mailboxData.specialUse,
                results: (listing.results || []).map(formatMessageListing)
            };

            res.json(response);
            return next();
        })
    );

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
     * @apiParam {String} [thread] Thread ID
     * @apiParam {String} [query] Search string, uses MongoDB fulltext index. Covers data from mesage body and also common headers like from, to, subject etc.
     * @apiParam {String} [datestart] Datestring for the earliest message storing time
     * @apiParam {String} [dateend] Datestring for the latest message storing time
     * @apiParam {String} [from] Partial match for the From: header line
     * @apiParam {String} [to] Partial match for the To: and Cc: header lines
     * @apiParam {String} [subject] Partial match for the Subject: header line
     * @apiParam {Boolean} [attachments] If true, then matches only messages with attachments
     * @apiParam {Boolean} [flagged] If true, then matches only messages with \Flagged flags
     * @apiParam {Boolean} [unseen] If true, then matches only messages without \Seen flags
     * @apiParam {Boolean} [searchable] If true, then matches messages not in Junk or Trash
     * @apiParam {Object} [or] Allows to specify some requests as OR (default is AND). At least one of the values in or block must match
     * @apiParam {String} [or.query] Search string, uses MongoDB fulltext index. Covers data from mesage body and also common headers like from, to, subject etc.
     * @apiParam {String} [or.from] Partial match for the From: header line
     * @apiParam {String} [or.to] Partial match for the To: and Cc: header lines
     * @apiParam {String} [or.subject] Partial match for the Subject: header line
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
     * @apiSuccess {Object[]} results.to Recipients in To: field
     * @apiSuccess {String} results.to.name Name of the recipient
     * @apiSuccess {String} results.to.address Address of the recipient
     * @apiSuccess {Object[]} results.cc Recipients in Cc: field
     * @apiSuccess {String} results.cc.name Name of the recipient
     * @apiSuccess {String} results.cc.address Address of the recipient
     * @apiSuccess {Object[]} results.bcc Recipients in Bcc: field. Usually only available for drafts
     * @apiSuccess {String} results.bcc.name Name of the recipient
     * @apiSuccess {String} results.bcc.address Address of the recipient
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
     * @apiExample {curl} Using OR:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/search?or.from=Ryan&or.to=Ryan"
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
    server.get(
        { name: 'search', path: '/users/:user/search' },
        tools.asyncifyJson(async (req, res, next) => {
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
                thread: Joi.string()
                    .hex()
                    .length(24)
                    .empty(''),

                or: Joi.object().keys({
                    query: Joi.string()
                        .trim()
                        .max(255)
                        .empty(''),
                    from: Joi.string()
                        .trim()
                        .empty(''),
                    to: Joi.string()
                        .trim()
                        .empty(''),
                    subject: Joi.string()
                        .trim()
                        .empty('')
                }),

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
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
                flagged: Joi.boolean()
                    .empty('')
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
                unseen: Joi.boolean()
                    .empty('')
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
                searchable: Joi.boolean()
                    .empty('')
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
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
                page: Joi.number().default(1),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            req.query.user = req.params.user;

            const result = Joi.validate(req.query, schema, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = result.value.mailbox ? new ObjectID(result.value.mailbox) : false;
            let thread = result.value.thread ? new ObjectID(result.value.thread) : false;

            let orTerms = result.value.or || {};
            let orQuery = [];

            let query = result.value.query;
            let datestart = result.value.datestart || false;
            let dateend = result.value.dateend || false;
            let filterFrom = result.value.from;
            let filterTo = result.value.to;
            let filterSubject = result.value.subject;
            let filterAttachments = result.value.attachments;
            let filterFlagged = result.value.flagged;
            let filterUnseen = result.value.unseen;
            let filterSearchable = result.value.searchable;

            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            username: true,
                            address: true,
                            specialUse: true
                        }
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
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
                filter.$text = { $search: query };
            } else if (orTerms.query) {
                filter.searchable = true;
                orQuery.push({ $text: { $search: query } });
            }

            if (mailbox) {
                filter.mailbox = mailbox;
            }

            if (thread) {
                filter.thread = thread;
            }

            if (filterFlagged) {
                // mailbox is not needed as there's a special index for flagged messages
                filter.flagged = true;
            }

            if (filterUnseen) {
                filter.unseen = true;
            }

            if (filterSearchable) {
                filter.searchable = true;
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

            if (orTerms.from) {
                let regex = orTerms.from.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                orQuery.push({
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

            if (orTerms.to) {
                let regex = orTerms.to.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');

                orQuery.push({
                    headers: {
                        $elemMatch: {
                            key: 'to',
                            value: {
                                $regex: regex,
                                $options: 'i'
                            }
                        }
                    }
                });

                orQuery.push({
                    headers: {
                        $elemMatch: {
                            key: 'cc',
                            value: {
                                $regex: regex,
                                $options: 'i'
                            }
                        }
                    }
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

            if (orTerms.subject) {
                let regex = filterSubject.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
                orQuery.push({
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

            if (orQuery.length) {
                filter.$or = orQuery;
            }

            if (!mailbox && mailboxNeeded) {
                // generate a list of mailbox ID values
                let mailboxes;
                try {
                    mailboxes = await db.database
                        .collection('mailboxes')
                        .find({ user })
                        .project({
                            _id: true
                        })
                        .toArray();
                } catch (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                filter.mailbox = { $in: mailboxes.map(m => m._id) };
            }

            let total = await getFilteredMessageCount(filter);

            let opts = {
                limit,
                query: filter,
                fields: {
                    // FIXME: hack to keep _id in response
                    _id: true,
                    // FIXME: MongoPaging inserts fields value as second argument to col.find()
                    projection: {
                        _id: true,
                        uid: true,
                        msgid: true,
                        mailbox: true,
                        'meta.from': true,
                        hdate: true,
                        subject: true,
                        'mimeTree.parsedHeader.from': true,
                        'mimeTree.parsedHeader.sender': true,
                        'mimeTree.parsedHeader.to': true,
                        'mimeTree.parsedHeader.cc': true,
                        'mimeTree.parsedHeader.bcc': true,
                        'mimeTree.parsedHeader.content-type': true,
                        'mimeTree.parsedHeader.references': true,
                        ha: true,
                        intro: true,
                        unseen: true,
                        undeleted: true,
                        flagged: true,
                        draft: true,
                        thread: true,
                        flags: true
                    }
                },
                paginatedField: '_id',
                sortAscending: false
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.database.collection('messages'), opts);
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let response = {
                success: true,
                query,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(formatMessageListing)
            };

            res.json(response);
            return next();
        })
    );

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
     * @apiSuccess {Object} envelope SMTP envelope (if available)
     * @apiSuccess {String} envelope.from Address from MAIL FROM
     * @apiSuccess {Object[]} envelope.rcpt Array of addresses from RCPT TO (should have just one normally)
     * @apiSuccess {String} envelope.rcpt.value RCPT TO address as provided by SMTP client
     * @apiSuccess {String} envelope.rcpt.formatted Normalized RCPT address
     * @apiSuccess {String} thread ID of the Thread
     * @apiSuccess {Object} from From: header info
     * @apiSuccess {String} from.name Name of the sender
     * @apiSuccess {String} from.address Address of the sender
     * @apiSuccess {Object[]} to To: header info
     * @apiSuccess {String} to.name Name of the recipient
     * @apiSuccess {String} to.address Address of the recipient
     * @apiSuccess {Object[]} cc Cc: header info
     * @apiSuccess {String} cc.name Name of the recipient
     * @apiSuccess {String} cc.address Address of the recipient
     * @apiSuccess {Object[]} bcc Recipients in Bcc: field. Usually only available for drafts
     * @apiSuccess {String} bcc.name Name of the recipient
     * @apiSuccess {String} bcc.address Address of the recipient
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
     * @apiSuccess {Object[]} [attachments] List of attachments for this message
     * @apiSuccess {String} attachments.id Attachment ID
     * @apiSuccess {String} attachments.filename Filename of the attachment
     * @apiSuccess {String} attachments.contentType MIME type
     * @apiSuccess {String} attachments.disposition Attachment disposition
     * @apiSuccess {String} attachments.transferEncoding Which transfer encoding was used (actual content when fetching attachments is not encoded)
     * @apiSuccess {Boolean} attachments.related Was this attachment found from a multipart/related node. This usually means that this is an embedded image
     * @apiSuccess {Number} attachments.sizeKb Approximate size of the attachment in kilobytes
     * @apiSuccess {Object} [verificationResults] Security verification info if message was received from MX. If this property is missing then do not automatically assume invalid TLS, SPF or DKIM.
     * @apiSuccess {Object} verificationResults.tls TLS information. Value is <code>false</code> if TLS was not used
     * @apiSuccess {Object} verificationResults.tls.name Cipher name, eg "ECDHE-RSA-AES128-GCM-SHA256"
     * @apiSuccess {Object} verificationResults.tls.version TLS version, eg "TLSv1/SSLv3"
     * @apiSuccess {Object} verificationResults.spf Domain name (either MFROM or HELO) of verified SPF or false if no SPF match was found
     * @apiSuccess {Object} verificationResults.dkim Domain name of verified DKIM signature or false if no valid signature was found
     * @apiSuccess {Object} contentType Parsed Content-Type header. Usually needed to identify encrypted messages and such
     * @apiSuccess {String} contentType.value MIME type of the message, eg. "multipart/mixed"
     * @apiSuccess {Object} contentType.params An object with Content-Type params as key-value pairs
     * @apiSuccess {String} metaData JSON formatted custom metadata object set for this message
     * @apiSuccess {Object} reference Referenced message info
     * @apiSuccess {Object[]} [files] List of files added to this message as attachments. Applies to Drafts, normal messages do not have this property. Needed to prevent uploading the same attachment every time a draft is updated
     * @apiSuccess {String} files.id File ID
     * @apiSuccess {String} files.filename Filename of the attached file
     * @apiSuccess {String} files.contentType MIME type
     * @apiSuccess {Number} files.size MIME type
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
     *       "thread": "59fc66a13e54454869460e50",
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
     *       },
     *       "metaData": "{}"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.get(
        { name: 'message', path: '/users/:user/mailboxes/:mailbox/messages/:message' },
        tools.asyncifyJson(async (req, res, next) => {
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
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),
                markAsSeen: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let message = result.value.message;
            let replaceCidLinks = result.value.replaceCidLinks;

            let messageData;
            try {
                messageData = await db.database.collection('messages').findOne(
                    {
                        mailbox,
                        uid: message
                    },
                    {
                        projection: {
                            _id: true,
                            user: true,
                            thread: true,
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
                            flags: true,
                            attachments: true,
                            html: true,
                            text: true,
                            textFooter: true,
                            forwardTargets: true,
                            meta: true,
                            verificationResults: true
                        }
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!messageData || messageData.user.toString() !== user.toString()) {
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            let parsedHeader = (messageData.mimeTree && messageData.mimeTree.parsedHeader) || {};

            let envelope = {
                from: (messageData.meta && messageData.meta.from) || '',
                rcpt: []
                    .concat((messageData.meta && messageData.meta.to) || [])
                    .map(rcpt => rcpt && rcpt.trim())
                    .filter(rcpt => rcpt)
                    .map(rcpt => ({
                        value: rcpt,
                        formatted: tools.normalizeAddress(rcpt, false, { removeLabel: true, removeDots: true })
                    }))
            };

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

            let bcc = parsedHeader.bcc;
            if (bcc) {
                tools.decodeAddresses(bcc);
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

            if (result.value.markAsSeen && messageData.unseen) {
                // we need to mark this message as seen
                try {
                    await updateMessage(user, mailbox, message, { seen: true });
                } catch (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }
                messageData.unseen = false;
            }

            let response = {
                success: true,
                id: message,
                mailbox,
                thread: messageData.thread,
                user,
                envelope,
                from: from[0],
                replyTo,
                to,
                cc,
                bcc,
                subject: messageData.subject,
                messageId: messageData.msgid,
                date: messageData.hdate.toISOString(),
                list,
                expires,
                seen: !messageData.unseen,
                deleted: !messageData.undeleted,
                flagged: messageData.flagged,
                draft: messageData.draft,
                answered: messageData.flags.includes('\\Answered'),
                forwarded: messageData.flags.includes('$Forwarded'),
                html: messageData.html,
                text: messageData.text,
                forwardTargets: messageData.forwardTargets,
                attachments: messageData.attachments || [],
                references: (parsedHeader.references || '')
                    .toString()
                    .split(/\s+/)
                    .filter(ref => ref),
                metaData: messageData.meta.custom || '{}'
            };

            if (messageData.meta.files && messageData.meta.files.length) {
                response.files = messageData.meta.files;
            }

            if (messageData.verificationResults) {
                response.verificationResults = messageData.verificationResults;
            }

            if (messageData.meta.reference) {
                response.reference = messageData.meta.reference;
            }

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
        })
    );

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
    server.get(
        { name: 'raw', path: '/users/:user/mailboxes/:mailbox/messages/:message/message.eml' },
        tools.asyncifyJson(async (req, res, next) => {
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
                sess: Joi.string().max(255),
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
                res.status(500);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let message = result.value.message;

            let messageData;
            try {
                messageData = await db.database.collection('messages').findOne(
                    {
                        mailbox,
                        uid: message
                    },
                    {
                        projection: {
                            _id: true,
                            user: true,
                            mimeTree: true
                        }
                    }
                );
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!messageData || messageData.user.toString() !== user.toString()) {
                res.status(404);
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            let response = messageHandler.indexer.rebuild(messageData.mimeTree);
            if (!response || response.type !== 'stream' || !response.value) {
                res.status(404);
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            res.setHeader('Content-Type', 'message/rfc822');
            response.value.on('error', err => {
                log.error('API', 'message=%s error=%s', messageData._id, err.message);
                try {
                    res.end();
                } catch (err) {
                    //ignore
                }
            });
            response.value.pipe(res);
        })
    );

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
    server.get(
        { name: 'attachment', path: '/users/:user/mailboxes/:mailbox/messages/:message/attachments/:attachment' },
        tools.asyncifyJson(async (req, res, next) => {
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let message = result.value.message;
            let attachment = result.value.attachment;

            let messageData;
            try {
                messageData = await db.database.collection('messages').findOne(
                    {
                        mailbox,
                        uid: message,
                        user
                    },
                    {
                        projection: {
                            _id: true,
                            user: true,
                            attachments: true,
                            'mimeTree.attachmentMap': true
                        }
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!messageData || messageData.user.toString() !== user.toString()) {
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
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

            let attachmentData;
            try {
                attachmentData = await getAttachmentData(attachmentId);
            } catch (err) {
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

            attachmentStream.once('error', err => {
                log.error('API', 'message=%s attachment=%s error=%s', messageData._id, attachmentId, err.message);
                try {
                    res.end();
                } catch (err) {
                    //ignore
                }
            });

            if (!decode) {
                attachmentStream.pipe(res);
                return;
            }

            if (attachmentData.transferEncoding === 'base64') {
                attachmentStream.pipe(new libbase64.Decoder()).pipe(res);
            } else if (attachmentData.transferEncoding === 'quoted-printable') {
                attachmentStream.pipe(new libqp.Decoder()).pipe(res);
            } else {
                attachmentStream.pipe(res);
            }
        })
    );

    /**
     * @api {put} /users/:user/mailboxes/:mailbox/messages Update Message information
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
     * @apiParam {String} [metaData] Optional metadata, must be JSON formatted object
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} id If messages were moved then lists new ID values. Array entry is an array with first element pointing to old ID and second to new ID
     * @apiSuccess {Number} updated If messages were not moved, then indicates the number of updated messages
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Mark messages as unseen:
     *     curl -i -XPUT "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46/messages" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "message": "1,2,3",
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
    server.put('/users/:user/mailboxes/:mailbox/messages/:message', tools.asyncifyJson(putMessageHandler));
    server.put('/users/:user/mailboxes/:mailbox/messages', tools.asyncifyJson(putMessageHandler));

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
    server.del(
        '/users/:user/mailboxes/:mailbox/messages/:message',
        tools.asyncifyJson(async (req, res, next) => {
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
                sess: Joi.string().max(255),
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('messages'));
            } else {
                req.validate(roles.can(req.role).deleteAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let message = result.value.message;

            let messageData;
            try {
                messageData = await db.database.collection('messages').findOne({
                    mailbox,
                    uid: message
                });
            } catch (err) {
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

            try {
                await deleteMessage({
                    user,
                    mailbox: { user, mailbox },
                    messageData,
                    archive: !messageData.flags.includes('\\Draft')
                });
            } catch (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            res.json({
                success: true
            });
            return next();
        })
    );

    /**
     * @api {delete} /users/:user/mailboxes/:mailbox/messages Delete all Messages from a Mailbox
     * @apiName DeleteMessages
     * @apiGroup Messages
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Number} deleted Indicates count of deleted messages
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Delete all Messages:
     *     curl -i -XDELETE "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages"
     *
     * @apiSuccessExample {json} Delete Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "deleted": 51
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.del(
        '/users/:user/mailboxes/:mailbox/messages',
        tools.asyncifyJson(async (req, res, next) => {
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
                sess: Joi.string().max(255),
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('messages'));
            } else {
                req.validate(roles.can(req.role).deleteAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);

            let cursor = await db.database
                .collection('messages')
                .find({
                    mailbox
                })
                .sort({ uid: -1 });

            let messageData;
            let deleted = 0;
            let errors = 0;
            try {
                while ((messageData = await cursor.next())) {
                    if (!messageData || messageData.user.toString() !== user.toString()) {
                        continue;
                    }

                    try {
                        await deleteMessage({
                            user,
                            mailbox: { user, mailbox },
                            messageData,
                            archive: !messageData.flags.includes('\\Draft')
                        });
                        deleted++;
                    } catch (err) {
                        errors++;
                    }
                }
                await cursor.close();
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError',
                    deleted,
                    errors
                });
                return next();
            }

            res.json({
                success: true,
                deleted,
                errors
            });

            return next();
        })
    );

    /**
     * @api {post} /users/:user/mailboxes/:mailbox/messages Upload Message
     * @apiName UploadMessage
     * @apiGroup Messages
     * @apiDescription This method allows to upload either an RFC822 formatted message or a message structure to a mailbox. Raw message
     * is stored unmodified, no headers are added or removed. If you want to generate the uploaded message
     * from strucutred data fields, then do not use the <code>raw</code> property.
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
     * @apiParam {String} [raw] base64 encoded message source. Alternatively, you can provide this value as POST body by using message/rfc822 MIME type. If raw message is provided then it overrides any other mail configuration
     * @apiParam {Object} [from] Address for the From: header
     * @apiParam {String} from.name Name of the sender
     * @apiParam {String} from.address Address of the sender
     * @apiParam {Object[]} [to] Addresses for the To: header
     * @apiParam {String} [to.name] Name of the recipient
     * @apiParam {String} to.address Address of the recipient
     * @apiParam {Object[]} [cc] Addresses for the Cc: header
     * @apiParam {String} [cc.name] Name of the recipient
     * @apiParam {String} cc.address Address of the recipient
     * @apiParam {Object[]} [bcc] Addresses for the Bcc: header
     * @apiParam {String} [bcc.name] Name of the recipient
     * @apiParam {String} bcc.address Address of the recipient
     * @apiParam {String} [subject] Message subject. If not then resolved from Reference message
     * @apiParam {String} [text] Plaintext message
     * @apiParam {String} [html] HTML formatted message
     * @apiParam {Object[]} [headers] Custom headers for the message. If reference message is set then In-Reply-To and References headers are set  automaticall y
     * @apiParam {String} headers.key Header key ('X-Mailer')
     * @apiParam {String} headers.value Header value ('My Awesome Mailing Service')
     * @apiParam {String[]} [files] Attachments as storage file IDs. NB! When retrieving message info then an array of objects is returned. When uploading a message then an array of IDs is used.
     * @apiParam {Object[]} [attachments] Attachments for the message
     * @apiParam {String} attachments.content Base64 encoded attachment content
     * @apiParam {String} [attachments.filename] Attachment filename
     * @apiParam {String} [attachments.contentType] MIME type for the attachment file
     * @apiParam {String} [attachments.cid] Content-ID value if you want to reference to this attachment from HTML formatted message
     * @apiParam {String} [metaData] Optional metadata, must be JSON formatted object
     * @apiParam {Object} [reference] Optional referenced email. If uploaded message is a reply draft and relevant fields are not provided then these are resolved from the message to be replied to
     * @apiParam {String} reference.mailbox Mailbox ID
     * @apiParam {Number} reference.id Message ID in Mailbox
     * @apiParam {String} reference.action Either <code>reply</code>, <code>replyAll</code> or <code>forward</code>
     * @apiParam {String[]} reference.attachments=false If true, then includes all attachments from the original message. If it is an array of attachment ID's includes attachments from the list
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
     * @apiExample {curl} Upload a Message:
     *     curl -i -XPOST "http://localhost:8080/users/5a2f9ca57308fc3a6f5f811d/mailboxes/5a2f9ca57308fc3a6f5f811e/messages" \
     *     -H 'Content-type: message/rfc822' \
     *     -d 'From: sender@example.com
     *     To: recipient@example.com
     *     Subject: hello world!
     *
     *     Example message'
     * @apiExample {curl} Upload a Message Structure:
     *     curl -i -XPOST "http://localhost:8080/users/5a2f9ca57308fc3a6f5f811d/mailboxes/5a2f9ca57308fc3a6f5f811e/messages" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "from": {
     *         "name": "sender name",
     *         "address": "sender@example.com"
     *       },
     *       "to": [{
     *         "address": "andris@ethereal.email"
     *       }],
     *       "subject": "Hello world!",
     *       "text": "Test message"
     *     }'
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
    server.post(
        '/users/:user/mailboxes/:mailbox/messages',
        tools.asyncifyJson(async (req, res, next) => {
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
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),
                flagged: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),
                draft: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),

                raw: Joi.binary()
                    .max(consts.MAX_ALLOWED_MESSAGE_SIZE)
                    .empty(''),

                from: Joi.object().keys({
                    name: Joi.string()
                        .empty('')
                        .max(255),
                    address: Joi.string()
                        .email()
                        .required()
                }),

                replyTo: Joi.object().keys({
                    name: Joi.string()
                        .empty('')
                        .max(255),
                    address: Joi.string()
                        .email()
                        .required()
                }),

                to: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string()
                            .empty('')
                            .max(255),
                        address: Joi.string()
                            .email()
                            .required()
                    })
                ),

                cc: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string()
                            .empty('')
                            .max(255),
                        address: Joi.string()
                            .email()
                            .required()
                    })
                ),

                bcc: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string()
                            .empty('')
                            .max(255),
                        address: Joi.string()
                            .email()
                            .required()
                    })
                ),

                headers: Joi.array().items(
                    Joi.object().keys({
                        key: Joi.string()
                            .empty('')
                            .max(255),
                        value: Joi.string()
                            .empty('')
                            .max(100 * 1024)
                    })
                ),

                subject: Joi.string()
                    .empty('')
                    .max(255),
                text: Joi.string()
                    .empty('')
                    .max(1024 * 1024),
                html: Joi.string()
                    .empty('')
                    .max(1024 * 1024),

                files: Joi.array().items(
                    Joi.string()
                        .hex()
                        .lowercase()
                        .length(24)
                ),

                attachments: Joi.array().items(
                    Joi.object().keys({
                        filename: Joi.string()
                            .empty('')
                            .max(255),
                        contentType: Joi.string()
                            .empty('')
                            .max(255),
                        encoding: Joi.string()
                            .empty('')
                            .default('base64'),
                        content: Joi.string().required(),
                        cid: Joi.string()
                            .empty('')
                            .max(255)
                    })
                ),

                metaData: Joi.string()
                    .empty('')
                    .trim()
                    .max(1024 * 1024),

                reference: Joi.object().keys({
                    mailbox: Joi.string()
                        .hex()
                        .lowercase()
                        .length(24)
                        .required(),
                    id: Joi.number().required(),
                    action: Joi.string()
                        .valid('reply', 'replyAll', 'forward')
                        .required(),
                    attachments: Joi.alternatives().try(
                        Joi.boolean()
                            .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                            .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
                        Joi.array()
                            .items(
                                Joi.string()
                                    .regex(/^ATT\d+$/i)
                                    .uppercase()
                            )
                            .allow([])
                    )
                }),

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

            if (!req.params.raw && req.body && Buffer.isBuffer(req.body)) {
                req.params.raw = req.body;
            }

            if (!req.params.raw && req.body && !Buffer.isBuffer(req.body)) {
                Object.keys(req.body || {}).forEach(key => {
                    if (!(key in req.params)) {
                        req.params[key] = req.body[key];
                    }
                });
            }

            const result = Joi.validate(req.params, schema, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            if (result.value.metaData) {
                try {
                    let metaData = JSON.parse(result.value.metaData);
                    if (!metaData || typeof metaData !== 'object') {
                        throw new Error('Not an object');
                    }
                } catch (err) {
                    res.json({
                        error: 'metaData value must be valid JSON object string',
                        code: 'InputValidationError'
                    });
                    return next();
                }
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('messages'));
            } else {
                req.validate(roles.can(req.role).createAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let raw = result.value.raw;
            let date = result.value.date || new Date();
            let files = [];

            let mailboxData;
            try {
                mailboxData = await db.database.collection('mailboxes').findOne({
                    _id: mailbox,
                    user
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!mailboxData) {
                res.json({
                    error: 'This mailbox does not exist',
                    code: 'NoSuchMailbox'
                });
                return next();
            }

            let userData;
            try {
                userData = await db.users.collection('users').findOne({
                    _id: user
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!userData) {
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
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

            let extraHeaders = [];
            let extraAttachments = [];
            let referencedMessage = await getReferencedMessage(userData, result.value);

            if (referencedMessage) {
                if (['reply', 'replyAll'].includes(result.value.reference.action) && referencedMessage.inReplyTo) {
                    extraHeaders.push({ key: 'In-Reply-To', value: referencedMessage.inReplyTo });
                }
                if (referencedMessage.references) {
                    extraHeaders.push({ key: 'References', value: referencedMessage.references });
                }
                extraAttachments = referencedMessage.attachments || [];
                result.value.draft = true; // only draft messages can reference to another message
            }

            if (result.value.files && result.value.files.length) {
                for (let file of result.value.files) {
                    try {
                        let fileData = await storageHandler.get(userData._id, new ObjectID(file));
                        if (fileData) {
                            extraAttachments.push(fileData);
                            files.push({
                                id: fileData.id.toString(),
                                filename: fileData.filename,
                                contentType: fileData.contentType,
                                size: fileData.size
                            });
                        }
                    } catch (err) {
                        log.error('API', 'STORAGEFAIL user=%s file=%s error=%s', userData._id, file, err.message);
                    }
                }
            }

            let data = {
                from: result.value.from || { name: userData.name, address: userData.address },
                date,
                to: result.value.to,
                cc: result.value.cc,
                bcc: result.value.bcc,
                subject: result.value.subject || referencedMessage.subject,
                text: result.value.text,
                html: result.value.html,
                headers: extraHeaders.concat(result.value.headers || []),
                attachments: extraAttachments.concat(result.value.attachments || []),
                disableFileAccess: true,
                disableUrlAccess: true,
                keepBcc: true
            };

            if (data.html && typeof data.html === 'string') {
                let fromAddress = (data.from && data.from.address).toString() || os.hostname();
                let cids = new Map();
                data.html = data.html.replace(/(<img\b[^>]* src\s*=[\s"']*)(data:[^"'>\s]+)/gi, (match, prefix, dataUri) => {
                    if (cids.has(dataUri)) {
                        return prefix + 'cid:' + cids.get(dataUri);
                    }
                    let cid = uuid.v4() + '-attachments@' + fromAddress.split('@').pop();
                    data.attachments.push(
                        processDataUrl({
                            path: dataUri,
                            cid
                        })
                    );
                    cids.set(dataUri, cid);
                    return prefix + 'cid:' + cid;
                });
            }

            // ensure plaintext content if html is provided
            if (data.html && !data.text) {
                try {
                    // might explode on long or strange strings
                    data.text = htmlToText.fromString(data.html);
                } catch (E) {
                    // ignore
                }
            }

            // remove empty keys
            for (let key of Object.keys(data)) {
                if (!data[key]) {
                    delete data[key];
                }
            }

            let compiler = new MailComposer(data);
            let compiled = compiler.compile();
            let envelope = compiled.getEnvelope();

            envelope.from = data.from.address = await validateFromAddress(userData, envelope.from);
            if (!envelope.to.length && referencedMessage && ['reply', 'replyAll'].includes(result.value.reference.action)) {
                envelope.to = envelope.to.concat(parseAddresses(referencedMessage.replyTo || [])).concat(parseAddresses(referencedMessage.replyCc || []));
                data.to = [].concat(referencedMessage.replyTo || []);
                data.cc = [].concat(referencedMessage.replyCc || []);
            }

            if (!req.params.raw) {
                raw = await getCompiledMessage(data, {
                    isDraft: !!result.value.draft
                });
            }

            if (!raw || !raw.length) {
                res.json({
                    error: 'Empty message provided',
                    code: 'EmptyMessage'
                });
                return next();
            }

            if (userData.encryptMessages) {
                try {
                    let encrypted = await encryptMessage(userData.pubKey, raw);
                    if (encrypted) {
                        raw = encrypted;
                    }
                } catch (err) {
                    // ignore
                }
            }

            let status, messageData;
            try {
                let resp = await addMessage({
                    user,
                    mailbox: mailboxData,
                    meta: {
                        source: 'API',
                        from: '',
                        origin: result.value.ip || '127.0.0.1',
                        transtype: 'UPLOAD',
                        time: date,
                        custom: result.value.metaData || '',
                        reference: referencedMessage
                            ? {
                                  action: result.value.reference.action,
                                  mailbox: result.value.reference.mailbox,
                                  id: result.value.reference.id
                              }
                            : false,
                        envelope,
                        files
                    },
                    session: result.value.session,
                    date,
                    flags: []
                        .concat('unseen' in result.value ? (result.value.unseen ? [] : '\\Seen') : [])
                        .concat('flagged' in result.value ? (result.value.flagged ? '\\Flagged' : []) : [])
                        .concat('draft' in result.value ? (result.value.draft ? '\\Draft' : []) : []),
                    raw
                });
                status = resp.status;
                messageData = resp.data;
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.imapResponse
                });
                return next();
            }

            res.json({
                success: status,
                message: messageData
                    ? {
                          id: messageData.uid,
                          mailbox: messageData.mailbox
                      }
                    : false
            });
            return next();
        })
    );

    /**
     * @api {post} /users/:user/mailboxes/:mailbox/messages/:message/forward Forward stored Message
     * @apiName ForwardStoredMessage
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
     * @apiExample {curl} Forward a Message:
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
    server.post(
        '/users/:user/mailboxes/:mailbox/messages/:message/forward',
        tools.asyncifyJson(async (req, res, next) => {
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
                addresses: Joi.array().items(Joi.string().email()),
                sess: Joi.string().max(255),
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('messages'));
            } else {
                req.validate(roles.can(req.role).createAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let message = result.value.message;

            let messageData;
            try {
                messageData = await db.database.collection('messages').findOne(
                    {
                        mailbox,
                        uid: message
                    },
                    {
                        projection: {
                            _id: true,
                            mailbox: true,
                            user: true,
                            uid: true,
                            'meta.from': true,
                            'meta.to': true,
                            mimeTree: true,
                            forwardTargets: true
                        }
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!messageData || messageData.user.toString() !== user.toString()) {
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
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
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            let forwardData = {
                db,
                maildrop,
                parentId: messageData._id,
                sender: messageData.meta.from,
                recipient: messageData.meta.to,
                targets: forwardTargets,
                stream: response.value
            };

            let queueId;
            try {
                queueId = await asyncForward(forwardData);
            } catch (err) {
                log.error(
                    'API',
                    '%s FRWRDFAIL from=%s to=%s target=%s error=%s',
                    forwardData.parentId.toString(),
                    forwardData.sender,
                    forwardData.recipient,
                    forwardTargets.map(target => (typeof target.value === 'string' ? target.value : 'relay')).join(','),
                    err.message
                );
            }

            if (queueId) {
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

            try {
                await db.database.collection('messages').updateOne(
                    {
                        _id: messageData._id,
                        mailbox: messageData.mailbox,
                        uid: messageData.uid
                    },
                    {
                        $addToSet: {
                            outbound: queueId
                        }
                    }
                );
            } catch (err) {
                // ignore
            }

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
        })
    );

    /**
     * @api {post} /users/:user/mailboxes/:mailbox/messages/:message/submit Submit Draft for delivery
     * @apiName SubmitStoredMessage
     * @apiGroup Messages
     * @apiDescription This method allows to submit a draft message for delivery. Draft is moved to Sent mail folder.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} mailbox ID of the Mailbox
     * @apiParam {Number} message Message ID
     * @apiParam {Boolean} deleteFiles If true then deletes attachment files listed in metaData.files array
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} queueId Message ID in outbound queue
     * @apiSuccess {Object} [message] Information about submitted Message
     * @apiSuccess {String} message.mailbox Mailbox ID the draft was moved to (usually Sent mail)
     * @apiSuccess {Number} message.id Message ID in Mailbox
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Submit a Message:
     *     curl -i -XPOST "http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a13e54454869460e57/messages/1/submit" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *           "deleteFiles": true
     *     }'
     *
     * @apiSuccessExample {json} Submit Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "queueId": "1682f5a712f000dfb6",
     *       "message": {
     *         "id": 3,
     *         "mailbox": "5c279b4e17abae166446f968"
     *       }
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.post(
        '/users/:user/mailboxes/:mailbox/messages/:message/submit',
        tools.asyncifyJson(async (req, res, next) => {
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
                deleteFiles: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, '']),
                sess: Joi.string().max(255),
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('messages'));
            } else {
                req.validate(roles.can(req.role).createAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);
            let message = result.value.message;
            let deleteFiles = result.value.deleteFiles;

            let userData;
            try {
                userData = await db.users.collection('users').findOne({
                    _id: user
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let messageData;
            try {
                messageData = await db.database.collection('messages').findOne({
                    mailbox,
                    uid: message,
                    user
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!messageData) {
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            if (!messageData.draft) {
                res.json({
                    error: 'This message is not a draft',
                    code: 'MessageNotDraft'
                });
                return next();
            }

            let envelope = messageData.meta.envelope;
            if (!envelope) {
                // fetch envelope data from message headers
                envelope = {
                    from: parseAddresses(messageData.mimeTree.parsedHeader.from).shift() || '',
                    to: Array.from(
                        new Set(
                            []
                                .concat(parseAddresses(messageData.mimeTree.parsedHeader.to) || [])
                                .concat(parseAddresses(messageData.mimeTree.parsedHeader.cc) || [])
                                .concat(parseAddresses(messageData.mimeTree.parsedHeader.bcc) || [])
                        )
                    )
                };
                envelope.from = await validateFromAddress(userData, envelope.from);
            }

            if (!envelope.to || !envelope.to.length) {
                res.json({
                    success: true
                });
                return next();
            }

            let rebuilder = messageHandler.indexer.rebuild(messageData.mimeTree);
            if (!rebuilder || rebuilder.type !== 'stream' || !rebuilder.value) {
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            let queueId = await submitMessage(userData, envelope, rebuilder.value);
            let response = {
                success: true
            };

            if (queueId) {
                response.queueId = queueId;
                let moved = await moveMessage({
                    user,
                    source: {
                        user: messageData.user,
                        mailbox: messageData.mailbox
                    },
                    destination: {
                        user: messageData.user,
                        specialUse: '\\Sent'
                    },
                    updates: {
                        draft: false,
                        seen: false
                    },
                    messageQuery: messageData.uid
                });

                response.message = {
                    id: moved.info && moved.info.destinationUid && moved.info.destinationUid[0],
                    mailbox: moved.info && moved.info.target
                };
            }

            if (messageData.meta.reference) {
                let setFlag;
                switch (messageData.meta.reference.action) {
                    case 'reply':
                    case 'replyAll':
                        setFlag = '\\Answered';
                        break;
                    case 'forward':
                        setFlag = '$Forwarded';
                        break;
                }

                if (setFlag) {
                    try {
                        await db.database.collection('messages').updateOne(
                            {
                                mailbox: new ObjectID(messageData.meta.reference.mailbox),
                                uid: messageData.meta.reference.id,
                                user: messageData.user
                            },
                            {
                                $addToSet: {
                                    flags: setFlag
                                }
                            }
                        );
                    } catch (err) {
                        // not important
                    }
                }
            }

            if (deleteFiles && messageData.meta.files && messageData.meta.files.length) {
                for (let fileData of messageData.meta.files) {
                    try {
                        await storageHandler.delete(userData._id, new ObjectID(fileData.id));
                    } catch (err) {
                        log.error('API', 'STORAGEDELFAIL user=%s file=%s error=%s', userData._id, fileData.id, err.message);
                    }
                }
            }

            res.json(response);
            return next();
        })
    );

    /**
     * @api {get} /users/:user/archived/messages List archived messages
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
     * @apiSuccess {Object[]} results.to Recipients in To: field
     * @apiSuccess {String} results.to.name Name of the recipient
     * @apiSuccess {String} results.to.address Address of the recipient
     * @apiSuccess {Object[]} results.cc Recipients in Cc: field
     * @apiSuccess {String} results.cc.name Name of the recipient
     * @apiSuccess {String} results.cc.address Address of the recipient
     * @apiSuccess {Object[]} results.bcc Recipients in Bcc: field. Usually only available for drafts
     * @apiSuccess {String} results.bcc.name Name of the recipient
     * @apiSuccess {String} results.bcc.address Address of the recipient
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
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/archived/messages"
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
    server.get(
        { name: 'archived', path: '/users/:user/archived/messages' },
        tools.asyncifyJson(async (req, res, next) => {
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
                    .default(1),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            req.query.user = req.params.user;

            const result = Joi.validate(req.query, schema, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;
            let sortAscending = result.value.order === 'asc';

            let total = await db.database.collection('archived').countDocuments({ user });

            let opts = {
                limit,
                query: { user },
                fields: {
                    // FIXME: hack to keep _id in response
                    _id: true,
                    // FIXME: MongoPaging inserts fields value as second argument to col.find()
                    projection: {
                        _id: true,
                        uid: true,
                        msgid: true,
                        mailbox: true,
                        'meta.from': true,
                        hdate: true,
                        subject: true,
                        'mimeTree.parsedHeader.from': true,
                        'mimeTree.parsedHeader.sender': true,
                        'mimeTree.parsedHeader.to': true,
                        'mimeTree.parsedHeader.cc': true,
                        'mimeTree.parsedHeader.bcc': true,
                        'mimeTree.parsedHeader.content-type': true,
                        'mimeTree.parsedHeader.references': true,
                        ha: true,
                        intro: true,
                        unseen: true,
                        undeleted: true,
                        flagged: true,
                        draft: true,
                        thread: true,
                        flags: true
                    }
                },
                paginatedField: '_id',
                sortAscending
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.database.collection('archived'), opts);
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let response = {
                success: true,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || [])
                    .map(m => {
                        // prepare message for output
                        m.uid = m._id;
                        return m;
                    })
                    .map(formatMessageListing)
            };

            res.json(response);
            return next();
        })
    );

    /**
     * @api {post} /users/:user/archived/restore Restore archived messages
     * @apiName RestoreMessages
     * @apiGroup Archive
     * @apiDescription Initiates a restore task to move archived messages of a date range back
     * to the mailboxes the messages were deleted from.
     * If target mailbox does not exist, then the messages are moved to INBOX.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} start Datestring
     * @apiParam {String} end Datestring
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Restore a Message:
     *     curl -i -XPOST "http://localhost:8080/users/59fc66a03e54454869460e45/archived/restore" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "start": "2018-10-01T00:00:00.000Z",
     *       "end": "2018-10-08T23:59:59.999Z"
     *     }'
     *
     * @apiSuccessExample {json} Restore Response:
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
    server.post(
        { name: 'create_restore_task', path: '/users/:user/archived/restore' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                start: Joi.date()
                    .label('Start time')
                    .required(),
                end: Joi.date()
                    .label('End time')
                    .required(),
                sess: Joi.string().max(255),
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('messages'));
            } else {
                req.validate(roles.can(req.role).updateAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let start = result.value.start;
            let end = result.value.end;

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            _id: true
                        }
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let r;
            try {
                let now = new Date();
                r = await db.database.collection('tasks').insertOne({
                    task: 'restore',
                    locked: false,
                    lockedUntil: now,
                    created: now,
                    status: 'queued',
                    user,
                    start,
                    end
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: true,
                task: r.insertedId
            });
        })
    );

    /**
     * @api {post} /users/:user/archived/messages/:message/restore Restore archived Message
     * @apiName RestoreMessage
     * @apiGroup Archive
     * @apiDescription Restores a single archived message by moving it back to the mailbox it
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
     *     curl -i -XPOST "http://localhost:8080/users/59fc66a03e54454869460e45/archived/messages/59fc66a13e54454869460e58/restore" \
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
    server.post(
        { name: 'archived_restore', path: '/users/:user/archived/messages/:message/restore' },
        tools.asyncifyJson(async (req, res, next) => {
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
                    .length(24),
                sess: Joi.string().max(255),
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
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('messages'));
            } else {
                req.validate(roles.can(req.role).updateAny('messages'));
            }

            let user = new ObjectID(result.value.user);
            let message = new ObjectID(result.value.message);
            let mailbox = result.value.mailbox ? new ObjectID(result.value.mailbox) : false;

            let messageData;
            try {
                messageData = await db.database.collection('archived').findOne({
                    // hash key: {user, _id}
                    user,
                    _id: message
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!messageData) {
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            messageData.mailbox = mailbox || messageData.mailbox;
            delete messageData.archived;
            delete messageData.exp;
            delete messageData.rdate;

            let response = await putMessage(messageData);
            if (!response) {
                res.json({
                    success: false,
                    error: 'Failed to restore message'
                });
                return next();
            }

            try {
                await db.users.collection('users').updateOne(
                    {
                        _id: messageData.user
                    },
                    {
                        $inc: {
                            storageUsed: messageData.size
                        }
                    }
                );
            } catch (err) {
                log.error('API', 'action=restore message=%s error=%s', messageData._id, 'Failed to update user quota. ' + err.message);
            }

            res.json({
                success: true,
                mailbox: response.mailbox,
                id: response.uid
            });

            try {
                await db.database.collection('archived').deleteOne({
                    // hash key: {user, _id}
                    user,
                    _id: messageData._id
                });
            } catch (err) {
                // ignore
            }

            return next();
        })
    );

    async function getFilteredMessageCount(filter) {
        if (Object.keys(filter).length === 1 && filter.mailbox) {
            // try to use cached value to get the count
            return await getMailboxCounter(db, filter.mailbox);
        }

        return await db.database.collection('messages').countDocuments(filter);
    }

    async function getReferencedMessage(userData, options) {
        if (!options.reference) {
            return false;
        }

        let query = {};
        if (typeof options.reference === 'object') {
            query.mailbox = new ObjectID(options.reference.mailbox);
            query.uid = options.reference.id;
        } else {
            return false;
        }

        query.user = userData._id;

        let userAddresses = await db.users
            .collection('addresses')
            .find({ user: userData._id })
            .toArray();
        userAddresses = userAddresses.map(address => address.addrview);

        let messageData = await db.database.collection('messages').findOne(query, {
            projection: {
                attachments: true,
                'mimeTree.attachmentMap': true,
                'mimeTree.parsedHeader': true,
                thread: true
            }
        });

        if (!messageData) {
            return false;
        }

        let headers = (messageData && messageData.mimeTree && messageData.mimeTree.parsedHeader) || {};

        let subject = headers.subject || '';
        try {
            subject = libmime.decodeWords(subject).trim();
        } catch (E) {
            // failed to parse value
        }

        if (!/^\w+: /.test(subject)) {
            subject = ((options.reference.action === 'forward' ? 'Fwd' : 'Re') + ': ' + subject).trim();
        }

        let sender = headers['reply-to'] || headers.from || headers.sender;
        let replyTo = [];
        let replyCc = [];
        let uniqueRecipients = new Set();

        let checkAddress = (target, addr) => {
            let addrview = tools.normalizeAddress(addr.address, false, { removeLabel: true, removeDots: true });
            if (!userAddresses.includes(addrview) && !uniqueRecipients.has(addrview)) {
                uniqueRecipients.add(addrview);
                if (addr.name) {
                    try {
                        addr.name = libmime.decodeWords(addr.name).trim();
                    } catch (E) {
                        // failed to parse value
                    }
                }
                target.push(addr);
            }
        };

        [].concat(sender || {}).forEach(addr => checkAddress(replyTo, addr));

        if (options.reference.action === 'replyAll') {
            [].concat(headers.to || []).forEach(addr => {
                let walk = addr => {
                    if (addr.address) {
                        checkAddress(replyTo, addr);
                    } else if (addr.group) {
                        addr.group.forEach(walk);
                    }
                };
                walk(addr);
            });
            [].concat(headers.cc || []).forEach(addr => {
                let walk = addr => {
                    if (addr.address) {
                        checkAddress(replyCc, addr);
                    } else if (addr.group) {
                        addr.group.forEach(walk);
                    }
                };
                walk(addr);
            });
        }

        let messageId = (headers['message-id'] || '').trim();
        let references = (headers.references || '')
            .trim()
            .replace(/\s+/g, ' ')
            .split(' ')
            .filter(mid => mid);

        if (messageId && !references.includes(messageId)) {
            references.unshift(messageId);
        }

        if (references.length > 50) {
            references = references.slice(0, 50);
        }

        let attachments = false;
        if (options.reference.attachments && messageData.attachments && messageData.attachments.length) {
            // load attachments as well
            for (let attachment of messageData.attachments) {
                if (!attachment || attachment.related) {
                    // skip embedded images
                    continue;
                }
                if (Array.isArray(options.reference.attachments) && !options.reference.attachments.includes(attachment.id)) {
                    // skip attachments not listed in the API call
                    continue;
                }

                try {
                    let attachmentId = messageData.mimeTree.attachmentMap && messageData.mimeTree.attachmentMap[attachment.id];
                    let content = await fetchAttachment(attachmentId);
                    if (!attachments) {
                        attachments = [];
                    }
                    attachments.push({
                        content,
                        filename: attachment.filename,
                        contentType: attachment.contentType
                    });
                } catch (err) {
                    // ignore
                }
            }
        }

        return {
            replyTo,
            replyCc,
            subject,
            thread: messageData.thread,
            inReplyTo: messageId,
            references: references.join(' '),
            attachments
        };
    }

    async function fetchAttachment(attachmentId) {
        let attachmentData = await getAttachmentData(attachmentId);

        let decode = true;

        if (attachmentData.metadata.decoded) {
            attachmentData.metadata.decoded = false;
            decode = false;
        }

        return new Promise((resolve, reject) => {
            let attachmentStream = messageHandler.attachmentStorage.createReadStream(attachmentId, attachmentData);

            attachmentStream.once('error', err => {
                log.error('API', 'attachment=%s error=%s', attachmentId, err.message);
                reject(err);
            });

            let decodedStream;

            if (!decode) {
                decodedStream = attachmentStream;
            } else if (attachmentData.transferEncoding === 'base64') {
                decodedStream = new libbase64.Decoder();
                attachmentStream.pipe(decodedStream);
            } else if (attachmentData.transferEncoding === 'quoted-printable') {
                decodedStream = new libqp.Decoder();
                attachmentStream.pipe(decodedStream);
            } else {
                decodedStream = attachmentStream;
            }

            let chunks = [];
            let chunklen = 0;
            decodedStream.on('readable', () => {
                let chunk;
                while ((chunk = decodedStream.read()) !== null) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
            });

            decodedStream.once('end', () => {
                let raw = Buffer.concat(chunks, chunklen);
                resolve(raw);
            });
        });
    }

    async function validateFromAddress(userData, address) {
        return new Promise((resolve, reject) => {
            if (!address || address === userData.address) {
                // using default address, ok
                return resolve(userData.address);
            }

            userHandler.get(address, false, (err, resolvedUser) => {
                if (err) {
                    return reject(err);
                }

                if (!resolvedUser || resolvedUser._id.toString() !== userData._id.toString()) {
                    return resolve(userData.address);
                }

                return resolve(address);
            });
        });
    }

    function submitMessage(userData, envelope, stream) {
        return new Promise((resolve, reject) => {
            messageHandler.counters.ttlcounter('wdr:' + userData._id.toString(), envelope.to.length, userData.recipients, false, (err, result) => {
                if (err) {
                    err.code = 'ERRREDIS';
                    return reject(err);
                }

                let success = result.success;
                let sent = result.value;
                let ttl = result.ttl;

                let ttlHuman = false;
                if (ttl) {
                    if (ttl < 60) {
                        ttlHuman = ttl + ' seconds';
                    } else if (ttl < 3600) {
                        ttlHuman = Math.round(ttl / 60) + ' minutes';
                    } else {
                        ttlHuman = Math.round(ttl / 3600) + ' hours';
                    }
                }

                if (!success) {
                    log.info('API', 'RCPTDENY denied sent=%s allowed=%s expires=%ss.', sent, userData.recipients, ttl);
                    let err = new Error('You reached a daily sending limit for your account' + (ttl ? '. Limit expires in ' + ttlHuman : ''));
                    err.code = 'ERRSENDINGLIMIT';
                    return reject(err);
                }

                // push message to outbound queue
                let message = maildrop.push(
                    {
                        reason: 'submit',
                        from: envelope.from,
                        to: envelope.to,

                        // make sure we send out a message with current timestamp
                        updateDate: true
                    },
                    (err, ...args) => {
                        if (err || !args[0]) {
                            if (err) {
                                err.code = err.code || 'ERRCOMPOSE';
                            } else {
                                err = new Error('Could not queue message for delivery');
                                err.code = 'ERRCOMPOSE';
                            }
                            return reject(err);
                        }

                        let outbound = args[0].id;
                        return resolve(outbound);
                    }
                );

                if (message) {
                    stream.once('error', err => message.emit('error', err));
                    stream.pipe(message);
                }
            });
        });
    }
};

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

    let to = [].concat(parsedHeader.to || []);
    let cc = [].concat(parsedHeader.cc || []);
    let bcc = [].concat(parsedHeader.bcc || []);

    tools.decodeAddresses(from);
    tools.decodeAddresses(to);
    tools.decodeAddresses(cc);
    tools.decodeAddresses(bcc);

    let response = {
        id: messageData.uid,
        mailbox: messageData.mailbox,
        thread: messageData.thread,
        from: from && from[0],
        to,
        cc,
        bcc,
        messageId: messageData.msgid,
        subject: messageData.subject,
        date: messageData.hdate.toISOString(),
        intro: messageData.intro,
        attachments: !!messageData.ha,
        seen: !messageData.unseen,
        deleted: !messageData.undeleted,
        flagged: messageData.flagged,
        draft: messageData.draft,
        answered: messageData.flags.includes('\\Answered'),
        forwarded: messageData.flags.includes('$Forwarded'),
        references: (parsedHeader.references || '')
            .toString()
            .split(/\s+/)
            .filter(ref => ref)
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

async function getCompiledMessage(data, options) {
    options = options || {};
    return new Promise((resolve, reject) => {
        let compiler = new MailComposer(data);
        let compiled = compiler.compile();
        if (options.isDraft) {
            compiled.keepBcc = true;
        }
        let stream = compiled.createReadStream();
        let chunks = [];
        let chunklen = 0;
        stream.once('error', err => reject(err));
        stream.on('readable', () => {
            let chunk;
            while ((chunk = stream.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
        });
        stream.once('end', () => {
            let raw = Buffer.concat(chunks, chunklen);
            resolve(raw);
        });
    });
}

function parseAddresses(data) {
    let addresses = new Set();
    let walk = list => {
        if (typeof list === 'string') {
            list = [{ address: list }];
        }
        [].concat(list || []).forEach(item => {
            if (item.address) {
                addresses.add(item.address);
            }
            if (item.group) {
                walk(item.group);
            }
        });
    };
    walk([].concat(data || []));
    return Array.from(addresses);
}

function processDataUrl(element) {
    let parts = (element.path || element.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
    if (!parts) {
        return element;
    }

    element.content = /\bbase64$/i.test(parts[1]) ? Buffer.from(parts[2], 'base64') : Buffer.from(decodeURIComponent(parts[2]));

    if ('path' in element) {
        element.path = false;
    }

    if ('href' in element) {
        element.href = false;
    }

    parts[1].split(';').forEach(item => {
        if (/^\w+\/[^/]+$/i.test(item)) {
            element.contentType = element.contentType || item.toLowerCase();
        }
    });

    return element;
}
