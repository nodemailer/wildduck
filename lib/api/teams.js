'use strict';

const Joi = require('../joi');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const consts = require('../consts');
const roles = require('../roles');

module.exports = (db, server, userHandler) => {
    /**
     * @api {put} /teams/:team Update users belonging to a team
     * @apiName PutTeam
     * @apiGroup Teams
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} team Team id
     * @apiParam {String[]} [tags] A list of tags associated with users
     * @apiParam {Number} [retention] Default retention time in ms. Set to <code>0</code> to disable
     * @apiParam {Object|String} [metaData] Optional metadata, must be an object or JSON formatted string of an object
     * @apiParam {String} [language] Language code for the User
     * @apiParam {String[]} [targets] An array of forwarding targets. The value could either be an email address or a relay url to next MX server ("smtp://mx2.zone.eu:25") or an URL where mail contents are POSTed to
     * @apiParam {Number} [spamLevel] Relative scale for detecting spam. 0 means that everything is spam, 100 means that nothing is spam
     * @apiParam {Number} [quota] Allowed quota of the user in bytes
     * @apiParam {Number} [recipients] How many messages per 24 hour can be sent
     * @apiParam {Number} [forwards] How many messages per 24 hour can be forwarded
     * @apiParam {Number} [imapMaxUpload] How many bytes can be uploaded via IMAP during 24 hour
     * @apiParam {Number} [imapMaxDownload] How many bytes can be downloaded via IMAP during 24 hour
     * @apiParam {Number} [pop3MaxDownload] How many bytes can be downloaded via POP3 during 24 hour
     * @apiParam {Number} [imapMaxConnections] How many parallel IMAP connections are alowed
     * @apiParam {Number} [receivedMax] How many messages can be received from MX during 60 seconds
     * @apiParam {Boolean} [disable2fa] If true, then disables 2FA for this user
     * @apiParam {String[]} disabledScopes List of scopes that are disabled for this user ("imap", "pop3", "smtp")
     * @apiParam {Boolean} [disabled] If true then disables user account (can not login, can not receive messages)
     * @apiParam {String[]} [fromWhitelist] A list of additional email addresses this user can send mail from. Wildcard is allowed.
     * @apiParam {Boolean} [suspended] If true then disables authentication
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/teams/59fc66a03e54454869460e45 \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "suspended": true
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
     *       "error": "This team does not exist"
     *     }
     */
    server.put(
        '/teams/:team',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                team: Joi.string().hex().lowercase().length(24).required(),

                language: Joi.string().empty('').max(20),

                targets: Joi.array().items(
                    Joi.string().email(),
                    Joi.string().uri({
                        scheme: [/smtps?/, /https?/],
                        allowRelative: false,
                        relativeOnly: false
                    })
                ),

                spamLevel: Joi.number().min(0).max(100),

                fromWhitelist: Joi.array().items(Joi.string().trim().max(128)),

                metaData: Joi.alternatives().try(
                    Joi.string()
                        .empty('')
                        .trim()
                        .max(1024 * 1024),
                    Joi.object()
                ),

                retention: Joi.number().min(0),
                quota: Joi.number().min(0),
                recipients: Joi.number().min(0),
                forwards: Joi.number().min(0),

                imapMaxUpload: Joi.number().min(0),
                imapMaxDownload: Joi.number().min(0),
                pop3MaxDownload: Joi.number().min(0),
                imapMaxConnections: Joi.number().min(0),

                receivedMax: Joi.number().min(0),

                disable2fa: Joi.boolean().empty('').truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']),

                tags: Joi.array().items(Joi.string().trim().max(128)),

                disabledScopes: Joi.array()
                    .items(Joi.string().valid(...consts.SCOPES))
                    .unique(),

                disabled: Joi.boolean().empty('').truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']),

                suspended: Joi.boolean().empty('').truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']),

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
            let permission;
            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).updateOwn('users');
            } else {
                permission = roles.can(req.role).updateAny('users');
            }
            req.validate(permission);
            result.value = permission.filter(result.value);

            let targets = result.value.targets;

            if (targets) {
                for (let i = 0, len = targets.length; i < len; i++) {
                    let target = targets[i];
                    if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                        // email
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'mail',
                            value: target
                        };
                    } else if (/^smtps?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'relay',
                            value: target
                        };
                    } else if (/^https?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectID(),
                            type: 'http',
                            value: target
                        };
                    } else {
                        res.json({
                            error: 'Unknown target type "' + target + '"',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                }

                result.value.targets = targets;
            }

            if (result.value.tags) {
                let tagSeen = new Set();
                let tags = result.value.tags
                    .map(tag => tag.trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag.toLowerCase())) {
                            tagSeen.add(tag.toLowerCase());
                            return true;
                        }
                        return false;
                    })
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                result.value.tags = tags;
                result.value.tagsview = tags.map(tag => tag.toLowerCase());
            }

            if (result.value.fromWhitelist && result.value.fromWhitelist.length) {
                result.value.fromWhitelist = Array.from(new Set(result.value.fromWhitelist.map(address => tools.normalizeAddress(address))));
            }

            if (result.value.metaData) {
                if (typeof result.value.metaData === 'object') {
                    try {
                        result.value.metaData = JSON.stringify(result.value.metaData);
                    } catch (err) {
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
                        res.json({
                            error: 'metaData value must be valid JSON object string',
                            code: 'InputValidationError'
                        });
                        return next();
                    }
                }
            }

            let updateResponse;
            try {
                updateResponse = await userHandler.updateTeam(result.value.team, result.value);
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            let { success } = updateResponse || {};
            res.json({
                success
            });
            return next();
        })
    );

    /**
     * @api {put} /users/:id/logout Log out User
     * @apiName PutUserLogout
     * @apiGroup Users
     * @apiDescription This method logs out all user sessions in IMAP
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id Users unique ID.
     * @apiParam {String} [reason] Message to be shown to connected IMAP client
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/logout \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "reason": "Logout requested from API"
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
     *       "error": "This user does not exist"
     *     }
     */
    server.put(
        '/users/:user/logout',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                reason: Joi.string().empty('').max(128),
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
                req.validate(roles.can(req.role).readOwn('users'));
            } else {
                req.validate(roles.can(req.role).readAny('users'));
            }

            let success;
            try {
                success = await userHandler.logout(result.value.user, result.value.reason || 'Logout requested from API');
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success
            });
            return next();
        })
    );

    /**
     * @api {post} /users/:user/quota/reset Recalculate User quota
     * @apiName PostUserQuota
     * @apiGroup Users
     * @apiDescription This method recalculates quota usage for a User. Normally not needed, only use it if quota numbers are way off.
     * This method is not transactional, so if the user is currently receiving new messages then the resulting value is not exact.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Number} storageUsed Calculated quota usage for the user
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/quota/reset \
     *     -H 'Content-type: application/json' \
     *     -d '{}'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "storageUsed": 1234567
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.post(
        '/users/:user/quota/reset',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
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
                req.validate(roles.can(req.role).updateOwn('users'));
            } else {
                req.validate(roles.can(req.role).updateAny('users'));
            }

            let user = new ObjectID(result.value.user);

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            storageUsed: true
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

            let storageData;
            try {
                // calculate mailbox size by aggregating the size's of all messages
                // NB! Scattered query
                storageData = await db.database
                    .collection('messages')
                    .aggregate([
                        {
                            $match: {
                                user
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    user: '$user'
                                },
                                storageUsed: {
                                    $sum: '$size'
                                }
                            }
                        }
                    ])
                    .toArray();
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            let storageUsed = (storageData && storageData[0] && storageData[0].storageUsed) || 0;

            let updateResponse;
            try {
                // update quota counter
                updateResponse = await db.users.collection('users').findOneAndUpdate(
                    {
                        _id: userData._id
                    },
                    {
                        $set: {
                            storageUsed: Number(storageUsed) || 0
                        }
                    },
                    {
                        returnOriginal: true,
                        projection: {
                            storageUsed: true
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

            if (!updateResponse || !updateResponse.value) {
                res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
                return next();
            }

            server.loggelf({
                short_message: '[QUOTA] reset',
                _mail_action: 'quota',
                _user: userData._id,
                _set: Number(storageUsed) || 0,
                _previous_storage_used: Number(updateResponse.value.storageUsed) || 0,
                _storage_used: Number(storageUsed) || 0
            });

            res.json({
                success: true,
                storageUsed: Number(storageUsed) || 0,
                previousStorageUsed: Number(updateResponse.value.storageUsed) || 0
            });
            return next();
        })
    );

    /**
     * @api {post} /quota/reset Recalculate Quota for all Users
     * @apiName PostUserQuotaAll
     * @apiGroup Users
     * @apiDescription This method recalculates quota usage for all Users. Normally not needed, only use it if quota numbers are way off.
     * This method is not transactional, so if the user is currently receiving new messages then the resulting value is not exact.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id Users unique ID.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/quota/reset \
     *     -H 'Content-type: application/json' \
     *     -d '{}'
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
     *       "error": "Failed to process request"
     *     }
     */
    server.post(
        '/quota/reset',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
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
            req.validate(roles.can(req.role).updateAny('users'));

            let now = new Date();
            await db.database.collection('tasks').insertOne({
                task: 'quota',
                locked: false,
                lockedUntil: now,
                created: now,
                status: 'queued'
            });

            res.json({
                success: true
            });
            return next();
        })
    );

    /**
     * @api {post} /users/:id/password/reset Reset password for a User
     * @apiName ResetUserPassword
     * @apiGroup Users
     * @apiDescription This method generates a new temporary password for a User.
     * Additionally it removes all two-factor authentication settings
     *
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id Users unique ID.
     * @apiParam {String} [validAfter] Allow using the generated password not earlier than provided time
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} password Temporary password
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/5a1bda70bfbd1442cd96/password/reset \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "ip": "127.0.0.1"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "password": "temporarypass"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.post(
        '/users/:user/password/reset',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                validAfter: Joi.date().empty('').allow(false),
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
            req.validate(roles.can(req.role).updateAny('users'));

            let user = new ObjectID(result.value.user);

            let password;
            try {
                password = await userHandler.reset(user, result.value);
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success: true,
                password,
                validAfter: (result.value && result.value.validAfter) || new Date()
            });
            return next();
        })
    );

    /**
     * @api {delete} /users/:id Delete a User
     * @apiName DeleteUser
     * @apiGroup Users
     * @apiDescription This method deletes user and address entries from DB and schedules a background task to delete messages. You can call this method several times even if the user has already been deleted, in case there are still some pending messages.
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id Users unique ID.
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/5a1bda70bfbd1442cd96c6f0?ip=127.0.0.1
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
     *       "error": "This user does not exist"
     *     }
     */
    server.del(
        '/users/:user',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            if (req.query.sess) {
                req.params.sess = req.query.sess;
            }

            if (req.query.ip) {
                req.params.ip = req.query.ip;
            }

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
            req.validate(roles.can(req.role).deleteAny('users'));

            let user = new ObjectID(result.value.user);

            let status;
            try {
                status = await userHandler.delete(user, {});
            } catch (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success: status,
                code: 'TaskScheduled'
            });
            return next();
        })
    );
};