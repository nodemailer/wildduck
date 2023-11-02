'use strict';

const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const imapTools = require('../../imap-core/lib/imap-tools');
const tools = require('../tools');
const roles = require('../roles');
const util = require('util');
const { sessSchema, sessIPSchema, booleanSchema } = require('../schemas');
const { userId, mailboxId } = require('../schemas/request/general-schemas');
const { successRes } = require('../schemas/response/general-schemas');

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
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }
            if (!userData) {
                res.status(404);
                return res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
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
                    hidden: !!mailboxData.hidden
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

            return res.json({
                success: true,
                results: responses
            });
        })
    );

    server.post(
        {
            path: '/users/:user/mailboxes',
            summary: 'Create new Mailbox',
            validationObjs: {
                pathParams: { user: userId },
                requestBody: {
                    path: Joi.string()
                        .regex(/\/{2,}|\/$/, { invert: true })
                        .required()
                        .description('Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)'),
                    hidden: booleanSchema.default(false).description('Is the folder hidden or not. Hidden folders can not be opened in IMAP.'),
                    retention: Joi.number()
                        .min(0)
                        .description('Retention policy for the created Mailbox. Milliseconds after a message added to mailbox expires. Set to 0 to disable.'),
                    sess: sessSchema,
                    ip: sessIPSchema
                },
                queryParams: {},
                response: {
                    200: {
                        description: 'Success',
                        model: Joi.object({
                            success: successRes,
                            id: mailboxId
                        })
                    }
                }
            },
            tags: ['Mailboxes']
        },
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const { pathParams, requestBody, queryParams } = req.route.spec.validationObjs;

            const schema = Joi.object({
                ...pathParams,
                ...requestBody,
                ...queryParams
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true
            });

            if (result.error) {
                res.status(400);
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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

            let data = await createMailbox(user, path, opts);
            status = data.status;
            id = data.id;

            return res.json({
                success: !!status,
                id
            });
        })
    );

    server.get(
        '/users/:user/mailboxes/:mailbox',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');
            const schema = Joi.object({
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }
            if (!userData) {
                res.status(404);
                return res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
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
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }
            if (!mailboxData) {
                res.status(404);
                return res.json({
                    error: 'This mailbox does not exist',
                    code: 'NoSuchMailbox'
                });
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

            return res.json({
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
        })
    );

    server.put(
        '/users/:user/mailboxes/:mailbox',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                res.status(400);
                return res.json({
                    error: 'Nothing was changed'
                });
            }

            await updateMailbox(user, mailbox, updates);

            return res.json({
                success: true
            });
        })
    );

    server.del(
        '/users/:user/mailboxes/:mailbox',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).deleteAny('mailboxes'));
            }

            let user = new ObjectId(result.value.user);
            let mailbox = new ObjectId(result.value.mailbox);

            await deleteMailbox(user, mailbox);

            return res.json({
                success: true
            });
        })
    );
};
