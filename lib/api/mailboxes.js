'use strict';

const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const imapTools = require('../../imap-core/lib/imap-tools');
const tools = require('../tools');
const roles = require('../roles');
const util = require('util');
const { sessSchema, sessIPSchema, booleanSchema } = require('../schemas');

module.exports = (db, server, mailboxHandler) => {
    const getMailboxCounter = util.promisify(tools.getMailboxCounter);
    const updateMailbox = util.promisify(mailboxHandler.update.bind(mailboxHandler));
    const deleteMailbox = util.promisify(mailboxHandler.del.bind(mailboxHandler));
    const createMailbox = util.promisify((...args) => {
        let callback = args.pop();
        mailboxHandler.create(...args, (err, status, id) => {
            if (err) {
                return callback(err);
            }
            return callback(null, { status, id });
        });
    });

    server.get(
        '/users/:user/mailboxes',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                specialUse: booleanSchema.default(false),
                showHidden: booleanSchema.default(false),
                counters: booleanSchema.default(false),
                sizes: booleanSchema.default(false),
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
                req.validate(roles.can(req.role).readOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).readAny('mailboxes'));
            }

            let user = new ObjectId(result.value.user);
            let counters = result.value.counters;
            let sizes = result.value.sizes;

            let sizeValues = false;

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            address: true
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

            if (sizes) {
                try {
                    sizeValues = await db.database
                        .collection('messages')
                        .aggregate([
                            {
                                $match: {
                                    user
                                }
                            },
                            {
                                $project: {
                                    mailbox: '$mailbox',
                                    size: '$size'
                                }
                            },
                            {
                                $group: {
                                    _id: '$mailbox',
                                    mailboxSize: {
                                        $sum: '$size'
                                    }
                                }
                            }
                        ])
                        .toArray();
                } catch (err) {
                    // ignore
                }
            }

            let mailboxes;
            try {
                mailboxes = await db.database
                    .collection('mailboxes')
                    .find({
                        user
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

            if (!mailboxes) {
                mailboxes = [];
            }

            if (result.value.specialUse) {
                mailboxes = mailboxes.filter(mailboxData => mailboxData.path === 'INBOX' || mailboxData.specialUse);
            }

            if (!result.value.showHidden) {
                mailboxes = mailboxes.filter(mailboxData => !mailboxData.hidden);
            }

            mailboxes = mailboxes
                .map(mailboxData => mailboxData)
                .sort((a, b) => {
                    if (a.path === 'INBOX') {
                        return -1;
                    }
                    if (b.path === 'INBOX') {
                        return 1;
                    }
                    if (a.path.indexOf('INBOX/') === 0 && b.path.indexOf('INBOX/') !== 0) {
                        return -1;
                    }
                    if (a.path.indexOf('INBOX/') !== 0 && b.path.indexOf('INBOX/') === 0) {
                        return 1;
                    }
                    if (a.subscribed !== b.subscribed) {
                        return (a.subscribed ? 0 : 1) - (b.subscribed ? 0 : 1);
                    }
                    return a.path.localeCompare(b.path);
                });

            let responses = [];

            let counterOps = [];

            for (let mailboxData of mailboxes) {
                let path = mailboxData.path.split('/');
                let name = path.pop();

                let response = {
                    id: mailboxData._id.toString(),
                    name,
                    path: mailboxData.path,
                    specialUse: mailboxData.specialUse,
                    modifyIndex: mailboxData.modifyIndex,
                    subscribed: mailboxData.subscribed,
                    hidden: !mailboxData.hidden
                };

                if (mailboxData.retention) {
                    response.retention = mailboxData.retention;
                }

                if (sizeValues) {
                    for (let sizeValue of sizeValues) {
                        if (mailboxData._id.equals(sizeValue._id)) {
                            response.size = sizeValue.mailboxSize;
                            break;
                        }
                    }
                }

                if (!counters) {
                    responses.push(response);
                    continue;
                }

                let total, unseen;

                counterOps.push(
                    (async () => {
                        try {
                            total = await getMailboxCounter(db, mailboxData._id, false);
                        } catch (err) {
                            // ignore
                        }
                        response.total = total;
                    })()
                );

                counterOps.push(
                    (async () => {
                        try {
                            unseen = await getMailboxCounter(db, mailboxData._id, 'unseen');
                        } catch (err) {
                            // ignore
                        }
                        response.unseen = unseen;
                    })()
                );

                responses.push(response);
            }

            if (counterOps.length) {
                await Promise.all(counterOps);
            }

            res.json({
                success: true,
                results: responses
            });
        })
    );

    server.post(
        '/users/:user/mailboxes',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                path: Joi.string()
                    .regex(/\/{2,}|\/$/, { invert: true })
                    .required(),
                hidden: booleanSchema.default(false),
                retention: Joi.number().min(0),
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
                req.validate(roles.can(req.role).createOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).createAny('mailboxes'));
            }

            let user = new ObjectId(result.value.user);
            let path = imapTools.normalizeMailbox(result.value.path);
            let retention = result.value.retention;

            let opts = {
                subscribed: true,
                hidden: !!result.value.hidden
            };

            if (retention) {
                opts.retention = retention;
            }

            let status, id;
            try {
                let data = await createMailbox(user, path, opts);
                status = data.status;
                id = data.id;
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                res.json({
                    error: err.message,
                    code: err.code
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
        })
    );

    server.get(
        '/users/:user/mailboxes/:mailbox',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).allow('resolve').required(),
                path: Joi.string().regex(/\/{2,}|\/$/, { invert: true }),
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
                req.validate(roles.can(req.role).readOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).readAny('mailboxes'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = result.value.mailbox !== 'resolve' ? new ObjectId(result.value.mailbox) : 'resolve';

            let userData;

            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            address: true
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

            let mailboxQuery = {
                _id: mailbox,
                user
            };

            if (mailbox === 'resolve') {
                mailboxQuery = {
                    path: result.value.path,
                    user
                };
            }

            let mailboxData;
            try {
                mailboxData = await db.database.collection('mailboxes').findOne(mailboxQuery);
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

            mailbox = mailboxData._id;

            let path = mailboxData.path.split('/');
            let name = path.pop();

            let total, unseen;

            try {
                total = await getMailboxCounter(db, mailboxData._id, false);
            } catch (err) {
                // ignore
            }

            try {
                unseen = await getMailboxCounter(db, mailboxData._id, 'unseen');
            } catch (err) {
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
                hidden: !!mailboxData.hidden,
                total,
                unseen
            });
            return next();
        })
    );

    server.put(
        '/users/:user/mailboxes/:mailbox',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                path: Joi.string().regex(/\/{2,}|\/$/, { invert: true }),
                retention: Joi.number().empty('').min(0),
                subscribed: booleanSchema,
                hidden: booleanSchema,
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
                req.validate(roles.can(req.role).updateOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).updateAny('mailboxes'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);

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

            let status;
            try {
                status = await updateMailbox(user, mailbox, updates);
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                res.json({
                    error: err.message,
                    code: err.code
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
        })
    );

    server.del(
        '/users/:user/mailboxes/:mailbox',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
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
                req.validate(roles.can(req.role).deleteOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).deleteAny('mailboxes'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);

            let status;
            try {
                status = await deleteMailbox(user, mailbox);
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (typeof status === 'string') {
                res.status(500); // TODO: use response code specific status
                res.json({
                    error: 'Mailbox deletion failed with code ' + status,
                    code: status
                });
                return next();
            }

            res.json({
                success: true
            });
            return next();
        })
    );
};
