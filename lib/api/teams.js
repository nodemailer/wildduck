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
};