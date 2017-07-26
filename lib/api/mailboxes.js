'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const imapTools = require('../../imap-core/lib/imap-tools');
const tools = require('../tools');

module.exports = (db, server, mailboxHandler) => {
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
};
