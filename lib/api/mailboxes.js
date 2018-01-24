'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const imapTools = require('../../imap-core/lib/imap-tools');
const tools = require('../tools');

module.exports = (db, server, mailboxHandler) => {
    /**
     * @api {get} /users/:user/mailboxes List Mailboxes for an User
     * @apiName GetMailboxes
     * @apiGroup Mailboxes
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {Boolean} [counters=false] Should the response include counters (total + unseen). Counters come with some overhead.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} results List of user mailboxes
     * @apiSuccess {String} results.id Mailbox ID
     * @apiSuccess {String} results.name Name for the mailbox (unicode string)
     * @apiSuccess {String} results.path Full path of the mailbox, folders are separated by slashes, ends with the mailbox name (unicode string)
     * @apiSuccess {String} results.specialUse Either special use identifier or <code>null</code>. One of <code>\Drafts</code>, <code>\Junk</code>, <code>\Sent</code> or <code>\Trash</code>
     * @apiSuccess {Number} results.modifyIndex Modification sequence number. Incremented on every change in the mailbox.
     * @apiSuccess {Boolean} results.subscribed Mailbox subscription status. IMAP clients may unsubscribe from a folder.
     * @apiSuccess {Number} results.total How many messages are stored in this mailbox
     * @apiSuccess {Number} results.unseen How many unseen messages are stored in this mailbox
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45/mailboxes?counters=true
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
     *           "total": 15,
     *           "unseen": 0
     *         }
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This mailbox does not exist"
     *     }
     */
    server.get('/users/:user/mailboxes', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            counters: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false)
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let counters = result.value.counters;

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
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

                db.database
                    .collection('mailboxes')
                    .find({
                        user
                    })
                    .toArray((err, mailboxes) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                code: 'InternalDatabaseError'
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

                            tools.getMailboxCounter(db, mailbox._id, false, (err, total) => {
                                if (err) {
                                    // ignore
                                }
                                tools.getMailboxCounter(db, mailbox._id, 'unseen', (err, unseen) => {
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
            }
        );
    });

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
    server.post('/users/:user/mailboxes', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            path: Joi.string()
                .regex(/\/{2,}|\/$/g, { invert: true })
                .required(),
            retention: Joi.number().min(0)
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
    server.get('/users/:user/mailboxes/:mailbox', (req, res, next) => {
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
                .allow('resolve')
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

        let user = new ObjectID(result.value.user);
        let mailbox = result.value.mailbox !== 'resolve' ? new ObjectID(result.value.mailbox) : 'resolve';

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
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
                        path: req.query.path,
                        user
                    };
                }

                db.database.collection('mailboxes').findOne(mailboxQuery, (err, mailboxData) => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            code: 'InternalDatabaseError'
                        });
                        return next();
                    }
                    if (!mailboxData) {
                        res.json({
                            error: 'This mailbox does not exist'
                        });
                        return next();
                    }

                    mailbox = mailboxData._id;

                    let path = mailboxData.path.split('/');
                    let name = path.pop();

                    tools.getMailboxCounter(db, mailbox, false, (err, total) => {
                        if (err) {
                            // ignore
                        }
                        tools.getMailboxCounter(db, mailbox, 'unseen', (err, unseen) => {
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
            }
        );
    });

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
     * @apiParam {Number} [retention] Retention policy for the created Mailbox. Chaning retention value only affects messages added to this folder after the change
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
    server.put('/users/:user/mailboxes/:mailbox', (req, res, next) => {
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
            path: Joi.string().regex(/\/{2,}|\/$/g, { invert: true }),
            retention: Joi.number().min(0),
            subscribed: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
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
    server.del('/users/:user/mailboxes/:mailbox', (req, res, next) => {
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
};
