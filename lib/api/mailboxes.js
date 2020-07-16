'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const imapTools = require('../../imap-core/lib/imap-tools');
const tools = require('../tools');
const roles = require('../roles');
const util = require('util');

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

    /**
     * @api {get} /users/:user/mailboxes List Mailboxes for a User
     * @apiName GetMailboxes
     * @apiGroup Mailboxes
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {Boolean} [specialUse=false] Should the response include only folders with specialUse flag set.
     * @apiParam {Boolean} [showHidden=false] Hidden folders are not included in the listing by default.
     * @apiParam {Boolean} [counters=false] Should the response include counters (total + unseen). Counters come with some overhead.
     * @apiParam {Boolean} [sizes=false] Should the response include mailbox size in bytes. Size numbers come with a lot of overhead as an aggregated query is ran.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} results List of user mailboxes
     * @apiSuccess {String} results.id Mailbox ID
     * @apiSuccess {String} results.name Name for the mailbox (unicode string)
     * @apiSuccess {String} results.path Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)
     * @apiSuccess {String} results.specialUse Either special use identifier or <code>null</code>. One of <code>\Drafts</code>, <code>\Junk</code>, <code>\Sent</code> or <code>\Trash</code>
     * @apiSuccess {Number} results.modifyIndex Modification sequence number. Incremented on every change in the mailbox.
     * @apiSuccess {Boolean} results.subscribed Mailbox subscription status. IMAP clients may unsubscribe from a folder.
     * @apiSuccess {Boolean} results.hidden Is the folder hidden or not
     * @apiSuccess {Number} results.total How many messages are stored in this mailbox
     * @apiSuccess {Number} results.unseen How many unseen messages are stored in this mailbox
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes?counters=true
     *
     * @apiExample {curl} Special Use Only
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes?specialUse=true
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "results": [
     *         {
     *           "id": "59fc66a03e54454869460e46",
     *           "name": "INBOX",
     *           "path": "INBOX",
     *           "specialUse": null,
     *           "modifyIndex": 1808,
     *           "subscribed": true,
     *           "hidden": false,
     *           "total": 20,
     *           "unseen": 2
     *         },
     *         {
     *           "id": "59fc66a03e54454869460e47",
     *           "name": "Sent Mail",
     *           "path": "Sent Mail",
     *           "specialUse": "\\Sent",
     *           "modifyIndex": 145,
     *           "subscribed": true,
     *           "hidden": false,
     *           "total": 15,
     *           "unseen": 0
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
        '/users/:user/mailboxes',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                specialUse: Joi.boolean().truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']).default(false),
                showHidden: Joi.boolean().truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']).default(false),
                counters: Joi.boolean().truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']).default(false),
                sizes: Joi.boolean().truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']).default(false),
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).readAny('mailboxes'));
            }

            let user = new ObjectID(result.value.user);
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
                    id: mailboxData._id,
                    name,
                    path: mailboxData.path,
                    specialUse: mailboxData.specialUse,
                    modifyIndex: mailboxData.modifyIndex,
                    subscribed: mailboxData.subscribed,
                    hidden: !mailboxData.hidden
                };

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

    /**
     * @api {post} /users/:user/mailboxes Create new Mailbox
     * @apiName PostMailboxes
     * @apiGroup Mailboxes
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {String} path Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)
     * @apiParam {Boolean} [hidden=false] Is the folder hidden or not. Hidden folders can not be opened in IMAP.
     * @apiParam {Number} [retention=0] Retention policy for the created Mailbox. Milliseconds after a message added to mailbox expires. Set to 0 to disable.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id Mailbox ID
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "path": "First Level/Second 😎 Level/Folder Name"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1d2816153888cdcd62a715"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Mailbox creation failed with code ALREADYEXISTS"
     *     }
     */
    server.post(
        '/users/:user/mailboxes',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                path: Joi.string()
                    .regex(/\/{2,}|\/$/, { invert: true })
                    .required(),
                hidden: Joi.boolean().truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']).default(false),
                retention: Joi.number().min(0),
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).createAny('mailboxes'));
            }

            let user = new ObjectID(result.value.user);
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

    /**
     * @api {get} /users/:user/mailboxes/:mailbox Request Mailbox information
     * @apiName GetMailbox
     * @apiGroup Mailboxes
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {String} mailbox Mailbox unique ID
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id Mailbox ID
     * @apiSuccess {String} name Name for the mailbox (unicode string)
     * @apiSuccess {String} path Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)
     * @apiSuccess {String} specialUse Either special use identifier or <code>null</code>. One of <code>\Drafts</code>, <code>\Junk</code>, <code>\Sent</code> or <code>\Trash</code>
     * @apiSuccess {Number} modifyIndex Modification sequence number. Incremented on every change in the mailbox.
     * @apiSuccess {Boolean} subscribed Mailbox subscription status. IMAP clients may unsubscribe from a folder.
     * @apiSuccess {Boolean} hidden Is the folder hidden or not
     * @apiSuccess {Number} total How many messages are stored in this mailbox
     * @apiSuccess {Number} unseen How many unseen messages are stored in this mailbox
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/59fc66a03e54454869460e46
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     * {
     *   "success": true,
     *   "id": "59fc66a03e54454869460e46",
     *   "name": "INBOX",
     *   "path": "INBOX",
     *   "specialUse": null,
     *   "modifyIndex": 1808,
     *   "subscribed": true,
     *   "total": 20,
     *   "unseen": 2
     * }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This mailbox does not exist"
     *     }
     */
    server.get(
        '/users/:user/mailboxes/:mailbox',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');
            console.log(req.params);
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).allow('resolve').required(),
                path: Joi.string().regex(/\/{2,}|\/$/, { invert: true }),
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).readAny('mailboxes'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = result.value.mailbox !== 'resolve' ? new ObjectID(result.value.mailbox) : 'resolve';

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

    /**
     * @api {put} /users/:user/mailboxes/:mailbox Update Mailbox information
     * @apiName PutMailbox
     * @apiGroup Mailboxes
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {String} mailbox Mailbox unique ID
     * @apiParam {String} [path] Full path of the mailbox, use this to rename an existing Mailbox
     * @apiParam {Boolean} [hidden] Is the folder hidden or not. Hidden folders can not be opened in IMAP.
     * @apiParam {Number} [retention] Retention policy for the Mailbox. Changing retention value only affects messages added to this folder after the change
     * @apiParam {Boolean} [subscribed] Change Mailbox subscription state
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/5a1d2816153888cdcd62a715 \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "path": "Updated Folder Name"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Mailbox update failed with code ALREADYEXISTS"
     *     }
     */
    server.put(
        '/users/:user/mailboxes/:mailbox',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
                path: Joi.string().regex(/\/{2,}|\/$/, { invert: true }),
                retention: Joi.number().empty('').min(0),
                subscribed: Joi.boolean().empty('').truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0]),
                hidden: Joi.boolean().empty('').truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0]),
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).updateOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).updateAny('mailboxes'));
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

            let status;
            try {
                status = await updateMailbox(user, mailbox, updates);
            } catch (err) {
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

    /**
     * @api {delete} /users/:user/mailboxes/:mailbox Delete a Mailbox
     * @apiName DeleteMailbox
     * @apiGroup Mailboxes
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {String} mailbox Mailbox unique ID. Special use folders and INBOX can not be deleted
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes/5a1d2816153888cdcd62a715
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Mailbox deletion failed with code CANNOT"
     *     }
     */
    server.del(
        '/users/:user/mailboxes/:mailbox',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                mailbox: Joi.string().hex().lowercase().length(24).required(),
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('mailboxes'));
            } else {
                req.validate(roles.can(req.role).deleteAny('mailboxes'));
            }

            let user = new ObjectID(result.value.user);
            let mailbox = new ObjectID(result.value.mailbox);

            let status;
            try {
                status = await deleteMailbox(user, mailbox);
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (typeof status === 'string') {
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
