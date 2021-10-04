'use strict';

const config = require('wild-config');
const log = require('npmlog');
const libmime = require('libmime');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const addressparser = require('nodemailer/lib/addressparser');
const MailComposer = require('nodemailer/lib/mail-composer');
const { htmlToText } = require('html-to-text');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const consts = require('../consts');
const libbase64 = require('libbase64');
const libqp = require('libqp');
const forward = require('../forward');
const Maildropper = require('../maildropper');
const util = require('util');
const roles = require('../roles');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema, metaDataSchema } = require('../schemas');
const { preprocessAttachments } = require('../data-url');
const TaskHandler = require('../task-handler');

module.exports = (db, server, messageHandler, userHandler, storageHandler, settingsHandler) => {
    let maildrop = new Maildropper({
        db,
        zone: config.sender.zone,
        collection: config.sender.collection,
        gfs: config.sender.gfs,
        loopSecret: config.sender.loopSecret
    });

    const taskHandler = new TaskHandler({ database: db.database });

    const putMessage = util.promisify(messageHandler.put.bind(messageHandler));
    const updateMessage = util.promisify(messageHandler.update.bind(messageHandler));
    const deleteMessage = util.promisify(messageHandler.del.bind(messageHandler));

    const encryptMessage = util.promisify(messageHandler.encryptMessage.bind(messageHandler));

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

    const addThreadCountersToMessageList = async (user, list) => {
        const threadIdsToCount = list.map(message => message.thread);
        const threadCounts = await db.database
            .collection('messages')
            .aggregate([
                {
                    $match: {
                        user: new ObjectId(user),
                        thread: { $in: threadIdsToCount }
                    }
                },
                {
                    $group: {
                        _id: '$thread',
                        count: {
                            $sum: 1
                        }
                    }
                }
            ])
            .toArray();

        return list.map(message => {
            const matchingThreadCount = threadCounts.find(thread => thread._id.toString() === message.thread.toString());
            message.threadMessageCount = matchingThreadCount ? matchingThreadCount.count : undefined;
            return message;
        });
    };

    const putMessageHandler = async (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
            mailbox: Joi.string().hex().lowercase().length(24).required(),
            moveTo: Joi.string().hex().lowercase().length(24),
            message: Joi.string()
                .regex(/^\d+(,\d+)*$|^\d+:\d+$/i)
                .required(),
            seen: booleanSchema,
            deleted: booleanSchema,
            flagged: booleanSchema,
            draft: booleanSchema,
            expires: Joi.alternatives().try(Joi.date(), booleanSchema.allow(false)),
            metaData: metaDataSchema.label('metaData'),
            sess: sessSchema,
            ip: sessIPSchema
        });

        const result = schema.validate(req.params, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.status(400);
            res.json({
                error: result.error.message,
                code: 'InputValidationError',
                details: tools.validationErrors(result)
            });
            return next();
        }

        if (result.value.metaData) {
            if (typeof result.value.metaData === 'object') {
                try {
                    result.value.metaData = JSON.stringify(result.value.metaData);
                } catch (err) {
                    res.status(400);
                    res.json({
                        error: 'metaData value must be serializable to JSON',
                        code: 'InputValidationError'
                    });
                    return next();
                }
            } else {
                try {
                    let value = JSON.parse(result.value.metaData);
                    if (!value || typeof value !== 'object') {
                        throw new Error('Not an object');
                    }
                } catch (err) {
                    res.status(400);
                    res.json({
                        error: 'metaData value must be valid JSON object string',
                        code: 'InputValidationError'
                    });
                    return next();
                }
            }
        }

        // permissions check
        if (req.user && req.user === result.value.user) {
            req.validate(roles.can(req.role).updateOwn('messages'));
        } else {
            req.validate(roles.can(req.role).updateAny('messages'));
        }

        let user = new ObjectId(result.value.user);
        let mailbox = new ObjectId(result.value.mailbox);
        let moveTo = result.value.moveTo ? new ObjectId(result.value.moveTo) : false;
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
            res.status(404);
            res.json({
                error: 'Invalid message identifier',
                code: 'MessageNotFound'
            });
            return next();
        }

        if (moveTo) {
            let info;

            let lockKey = ['mbwr', mailbox.toString()].join(':');

            let lock;

            try {
                lock = await server.lock.waitAcquireLock(lockKey, 5 * 60 * 1000, 1 * 60 * 1000);
                if (!lock.success) {
                    throw new Error('Failed to get folder write lock');
                }
            } catch (err) {
                res.status(500);
                res.json({
                    error: err.message,
                    code: err.code || 'LockFail'
                });
                return next();
            }

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
                res.status(500); // TODO: use response code specific status
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            } finally {
                await server.lock.releaseLock(lock);
            }

            if (!info || !info.destinationUid || !info.destinationUid.length) {
                res.status(404);
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
            res.status(500); // TODO: use response code specific status
            res.json({
                error: err.message,
                code: err.code
            });
            return next();
        }

        if (!updated) {
            res.status(404);
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

    server.get(
        { name: 'messages', path: '/users/:user/mailboxes/:mailbox/messages' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                unseen: booleanSchema,
                metaData: booleanSchema.default(false),
                threadCounters: booleanSchema.default(false),
                limit: Joi.number().empty('').default(20).min(1).max(250),
                order: Joi.any().empty('').allow('asc', 'desc').default('desc'),
                next: nextPageCursorSchema,
                previous: previousPageCursorSchema,
                page: pageNrSchema,
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
            let limit = result.value.limit;
            let threadCounters = result.value.threadCounters;
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!mailboxData) {
                res.status(404);
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
                        [result.value.metaData ? 'meta' : 'meta.from']: true,
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
                        size: true,
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            if (threadCounters) {
                listing.results = await addThreadCountersToMessageList(user, listing.results);
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

    server.get(
        { name: 'search', path: '/users/:user/search' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().length(24).empty(''),
                thread: Joi.string().hex().length(24).empty(''),

                or: Joi.object().keys({
                    query: Joi.string().trim().max(255).empty(''),
                    from: Joi.string().trim().empty(''),
                    to: Joi.string().trim().empty(''),
                    subject: Joi.string().trim().empty('')
                }),

                query: Joi.string().trim().max(255).empty(''),
                datestart: Joi.date().label('Start time').empty(''),
                dateend: Joi.date().label('End time').empty(''),
                from: Joi.string().trim().empty(''),
                to: Joi.string().trim().empty(''),
                subject: Joi.string().trim().empty(''),
                minSize: Joi.number().empty(''),
                maxSize: Joi.number().empty(''),
                attachments: booleanSchema,
                flagged: booleanSchema,
                unseen: booleanSchema,
                searchable: booleanSchema,
                threadCounters: booleanSchema.default(false),
                limit: Joi.number().default(20).min(1).max(250),
                next: nextPageCursorSchema,
                previous: previousPageCursorSchema,
                page: pageNrSchema,
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = result.value.mailbox ? new ObjectId(result.value.mailbox) : false;
            let thread = result.value.thread ? new ObjectId(result.value.thread) : false;

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
            let filterMinSize = result.value.minSize;
            let filterMaxSize = result.value.maxSize;

            let threadCounters = result.value.threadCounters;
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

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
            } else if (filterSearchable) {
                // filter out Trash and Junk
                let mailboxes;
                try {
                    mailboxes = await db.database
                        .collection('mailboxes')
                        .find({ user, specialUse: { $in: ['\\Junk', '\\Trash'] } })
                        .project({
                            _id: true
                        })
                        .toArray();
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }
                filter.mailbox = { $nin: mailboxes.map(m => m._id) };
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
                filter.searchable = true;
            }

            if (filterSearchable) {
                filter.searchable = true;
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
                let regex = tools.escapeRegexStr(filterFrom);
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

            if (orTerms.from) {
                let regex = tools.escapeRegexStr(orTerms.from);
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
            }

            if (filterTo) {
                let regex = tools.escapeRegexStr(filterTo);
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

            if (orTerms.to) {
                let regex = tools.escapeRegexStr(orTerms.to);

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
            }

            if (filterSubject) {
                let regex = tools.escapeRegexStr(filterSubject);
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

            if (orTerms.subject) {
                let regex = tools.escapeRegexStr(orTerms.subject);
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
            }

            if (filterAttachments) {
                filter.ha = true;
            }

            if (filterMinSize) {
                filter.size = filter.size || {};
                filter.size.$gte = filterMinSize;
            }

            if (filterMaxSize) {
                filter.size = filter.size || {};
                filter.size.$lte = filterMaxSize;
            }

            if (orQuery.length) {
                filter.$or = orQuery;
            }

            let total = await getFilteredMessageCount(filter);
            log.verbose('API', 'Searching %s', JSON.stringify(filter));

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
                        size: true,
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            if (threadCounters) {
                listing.results = await addThreadCountersToMessageList(user, listing.results);
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

    server.get(
        { name: 'message', path: '/users/:user/mailboxes/:mailbox/messages/:message' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                message: Joi.number().min(1).required(),
                replaceCidLinks: booleanSchema.default(false),
                markAsSeen: booleanSchema.default(false),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
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
                            idate: true,
                            'mimeTree.parsedHeader': true,
                            'mimeTree.attachmentMap': true,
                            subject: true,
                            msgid: true,
                            exp: true,
                            rdate: true,
                            ha: true,
                            size: true,
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
                            verificationResults: true,
                            outbound: true
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
                date: messageData.hdate ? messageData.hdate.toISOString() : null,
                idate: messageData.idate ? messageData.idate.toISOString() : null,
                list,
                expires,
                size: messageData.size,
                seen: !messageData.unseen,
                deleted: !messageData.undeleted,
                flagged: messageData.flagged,
                draft: messageData.draft,
                answered: messageData.flags.includes('\\Answered') && !messageData.flags.includes('$Forwarded'),
                forwarded: messageData.flags.includes('$Forwarded'),
                html: messageData.html,
                text: messageData.text,
                forwardTargets: messageData.forwardTargets,
                attachments: (messageData.attachments || []).map(attachmentData => {
                    let hash = messageData.mimeTree && messageData.mimeTree.attachmentMap && messageData.mimeTree.attachmentMap[attachmentData.id];
                    if (!hash) {
                        return attachmentData;
                    }
                    return Object.assign({ hash: hash.toString('hex') }, attachmentData);
                }),
                references: (parsedHeader.references || '')
                    .toString()
                    .split(/\s+/)
                    .filter(ref => ref),
                metaData: tools.formatMetaData(messageData.meta.custom)
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

            if (messageData.outbound) {
                let queued = [];
                for (let queueId of messageData.outbound) {
                    let queueEntries = await db.senderDb.collection(config.sender.collection).find({ id: queueId }).toArray();
                    if (queueEntries && queueEntries.length) {
                        queued.push({
                            queueId,
                            entries: queueEntries.map(entry => ({
                                seq: entry.seq,
                                recipient: entry.recipient,
                                sendingZone: entry.sendingZone,
                                queued: entry.queued
                            }))
                        });
                    }
                }
                if (queued.length) {
                    response.outbound = queued;
                }
            }

            res.json(response);
            return next();
        })
    );

    server.get(
        { name: 'raw', path: '/users/:user/mailboxes/:mailbox/messages/:message/message.eml' },
        tools.asyncifyJson(async (req, res, next) => {
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                message: Joi.number().min(1).required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
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

    server.get(
        { name: 'attachment', path: '/users/:user/mailboxes/:mailbox/messages/:message/attachments/:attachment' },
        tools.asyncifyJson(async (req, res, next) => {
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                message: Joi.number().min(1).required(),
                attachment: Joi.string()
                    .regex(/^ATT\d+$/i)
                    .uppercase()
                    .required()
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('attachments'));
            } else {
                req.validate(roles.can(req.role).readAny('attachments'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
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

            let attachmentId = messageData.mimeTree.attachmentMap && messageData.mimeTree.attachmentMap[attachment];
            if (!attachmentId) {
                res.status(404);
                res.json({
                    error: 'This attachment does not exist',
                    code: 'AttachmentNotFound'
                });
                return next();
            }

            let attachmentData;
            try {
                attachmentData = await messageHandler.attachmentStorage.get(attachmentId);
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

            let attachmentStream;
            try {
                attachmentStream = messageHandler.attachmentStorage.createReadStream(attachmentId, attachmentData);
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'Failed to read attachment',
                    code: 'InternalError'
                });
                return next();
            }

            attachmentStream.once('error', err => {
                log.error('API', 'message=%s attachment=%s error=%s', messageData._id, attachment, err.message);
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

    server.put('/users/:user/mailboxes/:mailbox/messages/:message', tools.asyncifyJson(putMessageHandler));
    server.put('/users/:user/mailboxes/:mailbox/messages', tools.asyncifyJson(putMessageHandler));

    server.del(
        '/users/:user/mailboxes/:mailbox/messages/:message',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                message: Joi.number().min(1).required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('messages'));
            } else {
                req.validate(roles.can(req.role).deleteAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
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

    server.del(
        '/users/:user/mailboxes/:mailbox/messages',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                async: booleanSchema.default(false),
                skipArchive: booleanSchema.default(false),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('messages'));
            } else {
                req.validate(roles.can(req.role).deleteAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);

            if (result.value.async) {
                // instead of deleting immediatelly, scheule deletion task
                let r;

                try {
                    r = await taskHandler.ensure('clear-folder', { user, mailbox }, { user, mailbox, skipArchive: result.value.skipArchive });
                } catch (err) {
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                res.json({
                    success: true,
                    existing: r.existing,
                    scheduled: r.task
                });

                return next();
            }

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
                            archive: !messageData.flags.includes('\\Draft') && !result.value.skipArchive
                        });
                        deleted++;
                    } catch (err) {
                        errors++;
                    }
                }
                await cursor.close();
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError',
                    deleted,
                    errors
                });
                return next();
            }

            try {
                // clear counters
                await db.redis.multi().del(`total:${mailbox}`).del(`unseen:${mailbox}`).exec();
            } catch (err) {
                // ignore
            }

            res.json({
                success: true,
                deleted,
                errors
            });

            return next();
        })
    );

    server.post(
        '/users/:user/mailboxes/:mailbox/messages',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                date: Joi.date(),
                unseen: booleanSchema.default(false),
                flagged: booleanSchema.default(false),
                draft: booleanSchema.default(false),

                raw: Joi.binary().max(consts.MAX_ALLOWED_MESSAGE_SIZE).empty(''),

                from: Joi.object().keys({
                    name: Joi.string().empty('').max(255),
                    address: Joi.string().email({ tlds: false }).required()
                }),

                replyTo: Joi.object().keys({
                    name: Joi.string().empty('').max(255),
                    address: Joi.string().email({ tlds: false }).required()
                }),

                to: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string().empty('').max(255),
                        address: Joi.string().email({ tlds: false }).required()
                    })
                ),

                cc: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string().empty('').max(255),
                        address: Joi.string().email({ tlds: false }).required()
                    })
                ),

                bcc: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string().empty('').max(255),
                        address: Joi.string().email({ tlds: false }).required()
                    })
                ),

                headers: Joi.array().items(
                    Joi.object().keys({
                        key: Joi.string().empty('').max(255),
                        value: Joi.string()
                            .empty('')
                            .max(100 * 1024)
                    })
                ),

                subject: Joi.string().empty('').max(255),
                text: Joi.string()
                    .empty('')
                    .max(1024 * 1024),
                html: Joi.string()
                    .empty('')
                    .max(1024 * 1024),

                files: Joi.array().items(Joi.string().hex().lowercase().length(24)),

                attachments: Joi.array().items(
                    Joi.object().keys({
                        filename: Joi.string().empty('').max(255),
                        contentType: Joi.string().empty('').max(255),
                        encoding: Joi.string().empty('').default('base64'),
                        contentTransferEncoding: Joi.string().empty(''),
                        content: Joi.string().required(),
                        cid: Joi.string().empty('').max(255)
                    })
                ),

                metaData: metaDataSchema.label('metaData'),

                reference: Joi.object().keys({
                    mailbox: Joi.string().hex().lowercase().length(24).required(),
                    id: Joi.number().required(),
                    action: Joi.string().valid('reply', 'replyAll', 'forward').required(),
                    attachments: Joi.alternatives().try(
                        booleanSchema,
                        Joi.array().items(
                            Joi.string()
                                .regex(/^ATT\d+$/i)
                                .uppercase()
                        )
                    )
                }),

                sess: sessSchema,
                ip: sessIPSchema
            });

            if (!req.params.raw && req.body && (Buffer.isBuffer(req.body) || typeof req.body === 'string')) {
                req.params.raw = req.body;
            }

            // do this before validation so we would not end up with too large html values
            preprocessAttachments(req.params);

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            if (result.value.metaData) {
                if (typeof result.value.metaData === 'object') {
                    try {
                        result.value.metaData = JSON.stringify(result.value.metaData);
                    } catch (err) {
                        res.status(400);
                        res.json({
                            error: 'metaData value must be serializable to JSON',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                } else {
                    try {
                        let value = JSON.parse(result.value.metaData);
                        if (!value || typeof value !== 'object') {
                            throw new Error('Not an object');
                        }
                    } catch (err) {
                        res.status(400);
                        res.json({
                            error: 'metaData value must be valid JSON object string',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                }
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('messages'));
            } else {
                req.validate(roles.can(req.role).createAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!mailboxData) {
                res.status(404);
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }
            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            if (userData.quota && userData.storageUsed > userData.quota) {
                res.status(400);
                res.json({
                    error: 'User is over quota',
                    code: 'OverQuotaError'
                });
                return next();
            }

            if (userData.disabled || userData.suspended) {
                res.status(403);
                res.json({
                    error: 'User account is disabled',
                    code: 'UserDisabled'
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
                        let fileData = await storageHandler.get(userData._id, new ObjectId(file));
                        if (fileData) {
                            extraAttachments.push(fileData);
                            files.push({
                                id: fileData.id,
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
                keepBcc: true,

                newline: '\r\n'
            };

            // ensure plaintext content if html is provided
            if (data.html && !data.text) {
                try {
                    // might explode on long or strange strings
                    data.text = htmlToText(data.html);
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

            let envelopeFrom = envelope.from;

            if (result.value.draft) {
                // override From addresses for drafts
                envelope.from = data.from.address = await validateFromAddress(userData, envelopeFrom);
            }

            if (!result.value.to && !envelope.to.length && referencedMessage && ['reply', 'replyAll'].includes(result.value.reference.action)) {
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
                res.status(400);
                res.json({
                    error: 'Empty message provided',
                    code: 'EmptyMessage'
                });
                return next();
            }

            if (userData.encryptMessages && !result.value.draft) {
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
                res.status(500); // TODO: use response code specific status
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

    server.post(
        '/users/:user/mailboxes/:mailbox/messages/:message/forward',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                message: Joi.number().required(),
                target: Joi.number().min(1).max(1000),
                addresses: Joi.array().items(Joi.string().email({ tlds: false })),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('messages'));
            } else {
                req.validate(roles.can(req.role).createAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
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
                res.status(404);
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

    server.post(
        '/users/:user/mailboxes/:mailbox/messages/:message/submit',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                message: Joi.number().required(),
                deleteFiles: booleanSchema,
                sendTime: Joi.date(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('messages'));
            } else {
                req.validate(roles.can(req.role).createAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);
            let message = result.value.message;
            let deleteFiles = result.value.deleteFiles;
            let sendTime = result.value.sendTime;

            let userData;
            try {
                userData = await db.users.collection('users').findOne({
                    _id: user
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            if (userData.disabled || userData.suspended) {
                res.status(403);
                res.json({
                    error: 'User account is disabled',
                    code: 'UserDisabled'
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!messageData) {
                res.status(404);
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            if (!messageData.draft) {
                res.status(400);
                res.json({
                    error: 'This message is not a draft',
                    code: 'MessageNotDraft'
                });
                return next();
            }

            let now = new Date();
            if (!sendTime || sendTime < now) {
                sendTime = now;
            }

            // update message headers, use updated Date value
            if (messageData.mimeTree.header) {
                let headerFound = false;
                for (let i = 0; i < messageData.mimeTree.header.length; i++) {
                    if (/^date\s*:/i.test(messageData.mimeTree.header[i])) {
                        headerFound = true;
                        messageData.mimeTree.header[i] = `Date: ${sendTime.toUTCString().replace(/GMT/, '+0000')}`;
                    }
                }
                if (!headerFound) {
                    messageData.mimeTree.header.push(`Date: ${sendTime.toUTCString().replace(/GMT/, '+0000')}`);
                }

                messageData.mimeTree.parsedHeader.date = sendTime;

                // update Draft message entry. This is later moved to Sent Mail folder so the Date values
                // must be correct ones
                await db.database.collection('messages').updateOne(
                    {
                        _id: messageData._id
                    },
                    {
                        $set: {
                            'mimeTree.header': messageData.mimeTree.header,
                            'mimeTree.parsedHeader.date': sendTime,
                            hdate: sendTime
                        }
                    }
                );
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

                let envelopeFrom = envelope.from;
                envelope.from = await validateFromAddress(userData, envelopeFrom);
            }

            if (!envelope.to || !envelope.to.length) {
                res.json({
                    success: true
                });
                return next();
            }

            let rebuilder = messageHandler.indexer.rebuild(messageData.mimeTree);
            if (!rebuilder || rebuilder.type !== 'stream' || !rebuilder.value) {
                res.status(404);
                res.json({
                    error: 'This message does not exist',
                    code: 'MessageNotFound'
                });
                return next();
            }

            let queueId = await submitMessage(userData, envelope, sendTime, rebuilder.value);
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
                        seen: false,
                        outbound: [queueId]
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
                        setFlag = { $each: ['\\Answered', '$Forwarded'] };
                        break;
                }

                if (setFlag) {
                    try {
                        let mailbox = new ObjectId(messageData.meta.reference.mailbox);
                        let r = await db.database.collection('messages').findOneAndUpdate(
                            {
                                mailbox,
                                uid: messageData.meta.reference.id,
                                user: messageData.user
                            },
                            {
                                $addToSet: {
                                    flags: setFlag
                                }
                            },
                            {
                                returnDocument: 'after',
                                projection: {
                                    uid: true,
                                    flags: true
                                }
                            }
                        );
                        if (r && r.value) {
                            let messageData = r.value;

                            let notifyEntries = [
                                {
                                    command: 'FETCH',
                                    uid: messageData.uid,
                                    flags: messageData.flags,
                                    message: messageData._id,
                                    unseenChange: false
                                }
                            ];

                            await new Promise(resolve => {
                                messageHandler.notifier.addEntries(mailbox, notifyEntries, () => {
                                    messageHandler.notifier.fire(messageData.user);
                                    resolve();
                                });
                            });
                        }
                    } catch (err) {
                        // not important
                    }
                }
            }

            if (deleteFiles && messageData.meta.files && messageData.meta.files.length) {
                for (let fileData of messageData.meta.files) {
                    try {
                        await storageHandler.delete(userData._id, new ObjectId(fileData.id));
                    } catch (err) {
                        log.error('API', 'STORAGEDELFAIL user=%s file=%s error=%s', userData._id, fileData.id, err.message);
                    }
                }
            }

            server.loggelf({
                short_message: '[SUBMIT] draft',
                _mail_action: 'submit_draft',
                _user: userData._id.toString(),
                _queue_id: queueId,
                _sent_mailbox: response.message && response.message.mailbox,
                _sent_message: response.message && response.message.id,
                _send_time: sendTime && sendTime.toISOString && sendTime.toISOString(),
                _from: envelope.from,
                _to: envelope.to && envelope.to.join(','),
                _message_id: messageData.msgid,
                _subject: messageData.subject,
                _sess: result.value.session,
                _ip: result.value.ip
            });

            res.json(response);
            return next();
        })
    );

    server.del(
        '/users/:user/outbound/:queueId',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                queueId: Joi.string().hex().lowercase().min(18).max(24).required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('messages'));
            } else {
                req.validate(roles.can(req.role).deleteAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let queueId = result.value.queueId;

            let response = await maildrop.removeFromQueue(queueId, user);

            res.json(response);
            return next();
        })
    );

    server.get(
        { name: 'archived', path: '/users/:user/archived/messages' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                limit: Joi.number().empty('').default(20).min(1).max(250),
                next: nextPageCursorSchema,
                previous: previousPageCursorSchema,
                order: Joi.any().empty('').allow('asc', 'desc').default('desc'),
                page: pageNrSchema,
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('messages'));
            } else {
                req.validate(roles.can(req.role).readAny('messages'));
            }

            let user = new ObjectId(result.value.user);
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
                        size: true,
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
                res.status(500);
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

    server.post(
        { name: 'create_restore_task', path: '/users/:user/archived/restore' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                start: Joi.date().label('Start time').required(),
                end: Joi.date().label('End time').required(),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('messages'));
            } else {
                req.validate(roles.can(req.role).updateAny('messages'));
            }

            let user = new ObjectId(result.value.user);
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
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!userData) {
                res.status(404);
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            let task;
            try {
                task = await taskHandler.add('restore', { user, start, end });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: true,
                task
            });
        })
    );

    server.post(
        { name: 'archived_restore', path: '/users/:user/archived/messages/:message/restore' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                message: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('messages'));
            } else {
                req.validate(roles.can(req.role).updateAny('messages'));
            }

            let user = new ObjectId(result.value.user);
            let message = new ObjectId(result.value.message);
            let mailbox = result.value.mailbox ? new ObjectId(result.value.mailbox) : false;

            let messageData;
            try {
                messageData = await db.database.collection('archived').findOne({
                    // hash key: {user, _id}
                    user,
                    _id: message
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!messageData) {
                res.status(404);
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
            return await getMailboxCounter(db, filter.mailbox, false);
        }

        return await db.database.collection('messages').countDocuments(filter);
    }

    async function getReferencedMessage(userData, options) {
        if (!options.reference) {
            return false;
        }

        let query = {};
        if (typeof options.reference === 'object') {
            query.mailbox = new ObjectId(options.reference.mailbox);
            query.uid = options.reference.id;
        } else {
            return false;
        }

        query.user = userData._id;

        let userAddresses = await db.users.collection('addresses').find({ user: userData._id }).toArray();
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
        let attachmentData = await messageHandler.attachmentStorage.get(attachmentId);

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
        if (!address || address === userData.address) {
            // using default address, ok
            return userData.address;
        }

        if (userData.fromWhitelist && userData.fromWhitelist.length) {
            if (
                userData.fromWhitelist.some(addr => {
                    if (addr === address) {
                        return true;
                    }

                    if (addr.charAt(0) === '*' && address.indexOf(addr.substr(1)) >= 0) {
                        return true;
                    }

                    if (addr.charAt(addr.length - 1) === '*' && address.indexOf(addr.substr(0, addr.length - 1)) === 0) {
                        return true;
                    }

                    return false;
                })
            ) {
                // whitelisted address
                return address;
            }
        }

        let resolvedUser = await userHandler.asyncGet(address, false);

        if (!resolvedUser || resolvedUser._id.toString() !== userData._id.toString()) {
            return userData.address;
        }

        return address;
    }

    async function submitMessage(userData, envelope, sendTime, stream) {
        let settings = await settingsHandler.getMulti(['const:max:recipients']);
        let maxRecipients = Number(userData.recipients) || config.maxRecipients || settings['const:max:recipients'];

        return new Promise((resolve, reject) => {
            messageHandler.counters.ttlcounter('wdr:' + userData._id.toString(), envelope.to.length, maxRecipients, false, (err, result) => {
                if (err) {
                    err.responseCode = 500;
                    err.code = 'InternalDatabaseError';
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
                    log.info('API', 'RCPTDENY denied sent=%s allowed=%s expires=%ss.', sent, maxRecipients, ttl);
                    let err = new Error('You reached a daily sending limit for your account' + (ttl ? '. Limit expires in ' + ttlHuman : ''));
                    err.responseCode = 403;
                    err.code = 'RateLimitedError';
                    return reject(err);
                }

                // push message to outbound queue
                let message = maildrop.push(
                    {
                        user: userData._id,
                        reason: 'submit',
                        from: envelope.from,
                        to: envelope.to,
                        sendTime
                    },
                    (err, ...args) => {
                        if (err || !args[0]) {
                            if (err) {
                                err.code = err.code || 'ERRCOMPOSE';
                            } else {
                                err = new Error('Could not queue message for delivery');
                                err.code = 'ERRCOMPOSE';
                            }
                            err.responseCode = 500;
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
        threadMessageCount: messageData.threadMessageCount,
        from: from && from[0],
        to,
        cc,
        bcc,
        messageId: messageData.msgid,
        subject: messageData.subject,
        date: messageData.hdate ? messageData.hdate.toISOString() : null,
        idate: messageData.idate ? messageData.idate.toISOString() : null,
        intro: messageData.intro,
        attachments: !!messageData.ha,
        size: messageData.size,
        seen: !messageData.unseen,
        deleted: !messageData.undeleted,
        flagged: messageData.flagged,
        draft: messageData.draft,
        answered: messageData.flags.includes('\\Answered') && !messageData.flags.includes('$Forwarded'),
        forwarded: messageData.flags.includes('$Forwarded'),
        references: (parsedHeader.references || '')
            .toString()
            .split(/\s+/)
            .filter(ref => ref)
    };

    if (messageData.meta && 'custom' in messageData.meta) {
        response.metaData = tools.formatMetaData(messageData.meta.custom);
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
