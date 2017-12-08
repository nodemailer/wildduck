'use strict';

const config = require('wild-config');
const Joi = require('../joi');
const MongoPaging = require('mongo-cursor-pagination-node6');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const errors = require('../errors');
const openpgp = require('openpgp');
const addressparser = require('addressparser');
const libmime = require('libmime');

module.exports = (db, server, userHandler) => {
    /**
     * @api {get} /users List registered Users
     * @apiName GetUsers
     * @apiGroup Users
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} [query] Partial match of username or default email address
     * @apiParam {String} [tags] Comma separated list of tags. The User must have at least one to be set
     * @apiParam {String} [requiredTags] Comma separated list of tags. The User must have all listed tags to be set
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
     * @apiSuccess {Object[]} results User listing
     * @apiSuccess {String} results.id Users unique ID (24 byte hex)
     * @apiSuccess {String} results.username Username of the User
     * @apiSuccess {String} results.name Name of the User
     * @apiSuccess {String} results.address Main email address of the User
     * @apiSuccess {String[]} results.tags List of tags associated with the User'
     * @apiSuccess {String[]} results.forward A list of email addresses to forward all incoming emails
     * @apiSuccess {Boolean} results.encryptMessages If <code>true</code> then received messages are encrypted
     * @apiSuccess {Boolean} results.encryptForwarded If <code>true</code> then forwarded messages are encrypted
     * @apiSuccess {Object} results.quota Quota usage limits
     * @apiSuccess {Number} results.quota.allowed Allowed quota of the user in bytes
     * @apiSuccess {Number} results.quota.used Space used in bytes
     * @apiSuccess {Boolean} results.hasPasswordSet If <code>true</code> then the User has a password set and can authenticate
     * @apiSuccess {Boolean} results.activated Is the account activated
     * @apiSuccess {Boolean} results.disabled If <code>true</code> then the user can not authenticate or receive any new mail
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users
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
     *           "id": "59cb948ad80a820b68f05230",
     *           "username": "myuser",
     *           "name": "John Doe",
     *           "address": "john@example.com",
     *           "tags": [],
     *           "forward": [],
     *           "encryptMessages": false,
     *           "encryptForwarded": false,
     *           "quota": {
     *             "allowed": 1073741824,
     *             "used": 17799833
     *           },
     *           "hasPasswordSet": true,
     *           "activated": true,
     *           "disabled": false
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
    server.get({ name: 'users', path: '/users' }, (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            query: Joi.string()
                .empty('')
                .lowercase()
                .max(128),
            tags: Joi.string()
                .trim()
                .empty('')
                .max(1024),
            requiredTags: Joi.string()
                .trim()
                .empty('')
                .max(1024),
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

        let query = result.value.query;
        let limit = result.value.limit;
        let page = result.value.page;
        let pageNext = result.value.next;
        let pagePrevious = result.value.previous;

        let filter = query
            ? {
                $or: [
                    {
                        address: {
                            $regex: query.replace(/\./g, ''),
                            $options: ''
                        }
                    },
                    {
                        unameview: {
                            $regex: query.replace(/\./g, ''),
                            $options: ''
                        }
                    }
                ]
            }
            : {};

        let tagSeen = new Set();

        let requiredTags = (result.value.requiredTags || '')
            .split(',')
            .map(tag => tag.toLowerCase().trim())
            .filter(tag => {
                if (tag && !tagSeen.has(tag)) {
                    tagSeen.add(tag);
                    return true;
                }
                return false;
            });

        let tags = (result.value.tags || '')
            .split(',')
            .map(tag => tag.toLowerCase().trim())
            .filter(tag => {
                if (tag && !tagSeen.has(tag)) {
                    tagSeen.add(tag);
                    return true;
                }
                return false;
            });

        let tagsview = {};
        if (requiredTags.length) {
            tagsview.$all = requiredTags;
        }
        if (tags.length) {
            tagsview.$in = tags;
        }

        if (requiredTags.length || tags.length) {
            filter.tagsview = tagsview;
        }

        db.users.collection('users').count(filter, (err, total) => {
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
                    username: true,
                    name: true,
                    address: true,
                    tags: true,
                    storageUsed: true,
                    forward: true,
                    targetUrl: true,
                    quota: true,
                    activated: true,
                    disabled: true,
                    password: true,
                    encryptMessages: true,
                    encryptForwarded: true
                },
                sortAscending: true
            };

            if (pageNext) {
                opts.next = pageNext;
            } else if (pagePrevious) {
                opts.previous = pagePrevious;
            }

            MongoPaging.find(db.users.collection('users'), opts, (err, result) => {
                if (err) {
                    res.json({
                        error: err.message
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
                    results: (result.results || []).map(userData => ({
                        id: userData._id.toString(),
                        username: userData.username,
                        name: userData.name,
                        address: userData.address,
                        tags: userData.tags || [],
                        forward: [].concat(userData.forward || []),
                        targetUrl: userData.targetUrl,
                        encryptMessages: !!userData.encryptMessages,
                        encryptForwarded: !!userData.encryptForwarded,
                        quota: {
                            allowed: Number(userData.quota) || config.maxStorage * 1024 * 1024,
                            used: Math.max(Number(userData.storageUsed) || 0, 0)
                        },
                        hasPasswordSet: !!userData.password,
                        activated: userData.activated,
                        disabled: userData.disabled
                    }))
                };

                res.json(response);
                return next();
            });
        });
    });

    /**
     * @api {post} /users Create new user
     * @apiName PostUser
     * @apiGroup Users
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} name Username of the User
     * @apiParam {String} [name] Name of the User
     * @apiParam {String} password New password for the account
     * @apiParam {String} [address] Default email address for the User (autogenerated if not set)
     * @apiParam {Boolean} [emptyAddress] If true then do not autogenerate missing email address for the User. Only needed if you want to create an user account that does not have any email address associated
     * @apiParam {Number} [retention] Default retention time in ms. Set to <code>0</code> to disable
     * @apiParam {Boolean} [encryptMessages] If <code>true</code> then received messages are encrypted
     * @apiParam {Boolean} [encryptForwarded] If <code>true</code> then forwarded messages are encrypted
     * @apiParam {String} [pubKey] Public PGP key for the User that is used for encryption. Use empty string to remove the key
     * @apiParam {String} [language] Language code for the User
     * @apiParam {String[]} [forward] A list of email addresses to forward all incoming emails
     * @apiParam {String} [targetUrl] An URL to post all incoming emails
     * @apiParam {Number} [quota] Allowed quota of the user in bytes
     * @apiParam {Number} [recipients] How many messages per 24 hour can be sent
     * @apiParam {Number} [forwards] How many messages per 24 hour can be forwarded
     * @apiParam {Number} [imapMaxUpload] How many bytes can be uploaded via IMAP during 24 hour
     * @apiParam {Number} [imapMaxDownload] How many bytes can be downloaded via IMAP during 24 hour
     * @apiParam {Number} [pop3MaxDownload] How many bytes can be downloaded via POP3 during 24 hour
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID for the created User
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "username": "myuser",
     *       "password": "verysecret",
     *       "name": "John Doe"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1bda70bfbd1442cd96c6f0"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This username already exists"
     *     }
     */
    server.post('/users', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            username: Joi.string()
                .lowercase()
                .regex(/^[a-z](?:\.?[a-z0-9]+)*$/, 'username')
                .min(1)
                .max(32)
                .required(),
            password: Joi.string()
                .allow(false)
                .max(256)
                .required(),

            address: Joi.string().email(),
            emptyAddress: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),

            language: Joi.string()
                .min(2)
                .max(20)
                .lowercase(),
            retention: Joi.number()
                .min(0)
                .default(0),

            name: Joi.string().max(256),
            forward: Joi.array().items(Joi.string().email()),
            targetUrl: Joi.string().max(256),

            quota: Joi.number()
                .min(0)
                .default(0),
            recipients: Joi.number()
                .min(0)
                .default(0),
            forwards: Joi.number()
                .min(0)
                .default(0),

            imapMaxUpload: Joi.number().min(0),
            imapMaxDownload: Joi.number().min(0),
            pop3MaxDownload: Joi.number().min(0),

            tags: Joi.array().items(
                Joi.string()
                    .trim()
                    .max(128)
            ),

            pubKey: Joi.string()
                .empty('')
                .trim()
                .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format'),
            encryptMessages: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
            encryptForwarded: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
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
                error: result.error.message
            });
            return next();
        }

        if (result.value.forward) {
            result.value.forward = [].concat(result.value.forward || []).map(fwd => tools.normalizeAddress(fwd));
        }

        if ('pubKey' in req.params && !result.value.pubKey) {
            result.value.pubKey = '';
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

        if (result.value.address && result.value.address.indexOf('*') >= 0) {
            res.json({
                error: 'Invalid character in email address: *'
            });
            return next();
        }

        checkPubKey(result.value.pubKey, err => {
            if (err) {
                res.json({
                    error: 'PGP key validation failed. ' + err.message
                });
                return next();
            }

            userHandler.create(result.value, (err, id) => {
                if (err) {
                    res.json({
                        error: err.message,
                        username: result.value.username
                    });
                    return next();
                }

                res.json({
                    success: !!id,
                    id
                });

                return next();
            });
        });
    });

    /**
     * @api {get} /users/:id Request User information
     * @apiName GetUser
     * @apiGroup Users
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id Users unique ID.
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id Users unique ID (24 byte hex)
     * @apiSuccess {String} username Username of the User
     * @apiSuccess {String} name Name of the User
     * @apiSuccess {String} address Main email address of the User
     * @apiSuccess {Number} retention Default retention time in ms. <code>false</code> if not enabled
     * @apiSuccess {String[]} enabled2fa List of enabled 2FA methods
     * @apiSuccess {Boolean} encryptMessages If <code>true</code> then received messages are encrypted
     * @apiSuccess {Boolean} encryptForwarded If <code>true</code> then forwarded messages are encrypted
     * @apiSuccess {String} pubKey Public PGP key for the User that is used for encryption
     * @apiSuccess {Object} keyInfo Information about public key or <code>false</code> if key is not available
     * @apiSuccess {String} keyInfo.name Name listed in public key
     * @apiSuccess {String} keyInfo.address E-mail address listed in public key
     * @apiSuccess {String} keyInfo.fingerprint Fingerprint of the public key
     * @apiSuccess {String[]} forward A list of email addresses to forward all incoming emails
     * @apiSuccess {String} targetUrl An URL to post all incoming emails
     * @apiSuccess {Object} limits Account limits and usage
     * @apiSuccess {Object} limits.quota Quota usage limits
     * @apiSuccess {Number} limits.quota.allowed Allowed quota of the user in bytes
     * @apiSuccess {Number} limits.quota.used Space used in bytes
     * @apiSuccess {Object} limits.recipients Sending quota
     * @apiSuccess {Number} limits.recipients.allowed How many messages per 24 hour can be sent
     * @apiSuccess {Number} limits.recipients.used How many messages are sent during current 24 hour period
     * @apiSuccess {Number} limits.recipients.ttl Time until the end of current 24 hour period
     * @apiSuccess {Object} limits.forwards Forwarding quota
     * @apiSuccess {Number} limits.forwards.allowed How many messages per 24 hour can be forwarded
     * @apiSuccess {Number} limits.forwards.used  How many messages are forwarded during current 24 hour period
     * @apiSuccess {Number} limits.forwards.ttl Time until the end of current 24 hour period
     * @apiSuccess {String[]}  tags List of tags associated with the User
     * @apiSuccess {Boolean} hasPasswordSet If <code>true</code> then the User has a password set and can authenticate
     * @apiSuccess {Boolean} activated Is the account activated
     * @apiSuccess {Boolean} disabled If <code>true</code> then the user can not authenticate or receive any new mail
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59fc66a03e54454869460e45",
     *       "username": "testuser01",
     *       "name": null,
     *       "address": "testuser01@example.com",
     *       "retention": false,
     *       "enabled2fa": [],
     *       "encryptMessages": false,
     *       "encryptForwarded": false,
     *       "pubKey": "",
     *       "keyInfo": false,
     *       "forward": [],
     *       "targetUrl": "",
     *       "limits": {
     *         "quota": {
     *           "allowed": 107374182400,
     *           "used": 289838
     *         },
     *         "recipients": {
     *           "allowed": 2000,
     *           "used": 0,
     *           "ttl": false
     *         },
     *         "forwards": {
     *           "allowed": 2000,
     *           "used": 0,
     *           "ttl": false
     *         }
     *       },
     *       "tags": ["green", "blue"],
     *       "hasPasswordSet": true,
     *       "activated": true,
     *       "disabled": false
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.get('/users/:user', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

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

                db.redis
                    .multi()
                    // sending counters are stored in Redis
                    .get('wdr:' + userData._id.toString())
                    .ttl('wdr:' + userData._id.toString())
                    .get('wdf:' + userData._id.toString())
                    .ttl('wdf:' + userData._id.toString())
                    .exec((err, result) => {
                        if (err) {
                            // ignore
                            errors.notify(err, { userId: user });
                        }

                        let recipients = Number(userData.recipients) || config.maxRecipients;
                        let forwards = Number(userData.forwards) || config.maxForwards;

                        let recipientsSent = Number(result && result[0] && result[0][1]) || 0;
                        let recipientsTtl = Number(result && result[1] && result[1][1]) || 0;

                        let forwardsSent = Number(result && result[2] && result[2][1]) || 0;
                        let forwardsTtl = Number(result && result[3] && result[3][1]) || 0;

                        res.json({
                            success: true,
                            id: user,

                            username: userData.username,
                            name: userData.name,

                            address: userData.address,

                            language: userData.language,
                            retention: userData.retention || false,

                            enabled2fa: Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []),

                            encryptMessages: userData.encryptMessages,
                            encryptForwarded: userData.encryptForwarded,
                            pubKey: userData.pubKey,
                            keyInfo: getKeyInfo(userData.pubKey),

                            forward: [].concat(userData.forward || []),
                            targetUrl: userData.targetUrl,

                            limits: {
                                quota: {
                                    allowed: Number(userData.quota) || config.maxStorage * 1024 * 1024,
                                    used: Math.max(Number(userData.storageUsed) || 0, 0)
                                },
                                recipients: {
                                    allowed: recipients,
                                    used: recipientsSent,
                                    ttl: recipientsTtl >= 0 ? recipientsTtl : false
                                },
                                forwards: {
                                    allowed: forwards,
                                    used: forwardsSent,
                                    ttl: forwardsTtl >= 0 ? forwardsTtl : false
                                }
                            },

                            tags: userData.tags || [],
                            hasPasswordSet: !!userData.password,
                            activated: userData.activated,
                            disabled: userData.disabled
                        });

                        return next();
                    });
            }
        );
    });

    /**
     * @api {put} /users/:id Update User information
     * @apiName PutUser
     * @apiGroup Users
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id Users unique ID.
     * @apiParam {String} [name] Name of the User
     * @apiParam {String} [existingPassword] If provided then validates against account password before applying any changes
     * @apiParam {String} [password] New password for the account
     * @apiParam {Number} [retention] Default retention time in ms. Set to <code>0</code> to disable
     * @apiParam {Boolean} [encryptMessages] If <code>true</code> then received messages are encrypted
     * @apiParam {Boolean} [encryptForwarded] If <code>true</code> then forwarded messages are encrypted
     * @apiParam {String} [pubKey] Public PGP key for the User that is used for encryption. Use empty string to remove the key
     * @apiParam {String} [language] Language code for the User
     * @apiParam {String[]} [forward] A list of email addresses to forward all incoming emails
     * @apiParam {String} [targetUrl] An URL to post all incoming emails
     * @apiParam {Number} [quota] Allowed quota of the user in bytes
     * @apiParam {Number} [recipients] How many messages per 24 hour can be sent
     * @apiParam {Number} [forwards] How many messages per 24 hour can be forwarded
     * @apiParam {Number} [imapMaxUpload] How many bytes can be uploaded via IMAP during 24 hour
     * @apiParam {Number} [imapMaxDownload] How many bytes can be downloaded via IMAP during 24 hour
     * @apiParam {Number} [pop3MaxDownload] How many bytes can be downloaded via POP3 during 24 hour
     * @apiParam {Boolean} [disabled] If true then disables user account (can not login, can not receive messages)
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45 \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "name": "Updated user name"
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
    server.put('/users/:user', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),

            existingPassword: Joi.string()
                .empty('')
                .min(1)
                .max(256),
            password: Joi.string()
                .min(8)
                .max(256),

            language: Joi.string()
                .min(2)
                .max(20)
                .lowercase(),

            name: Joi.string()
                .empty('')
                .max(256),
            forward: Joi.array().items(Joi.string().email()),
            targetUrl: Joi.string()
                .empty('')
                .max(256),

            pubKey: Joi.string()
                .empty('')
                .trim()
                .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format'),
            encryptMessages: Joi.boolean()
                .empty('')
                .truthy(['Y', 'true', 'yes', 1]),
            encryptForwarded: Joi.boolean()
                .empty('')
                .truthy(['Y', 'true', 'yes', 1]),
            retention: Joi.number().min(0),
            quota: Joi.number().min(0),
            recipients: Joi.number().min(0),
            forwards: Joi.number().min(0),

            imapMaxUpload: Joi.number().min(0),
            imapMaxDownload: Joi.number().min(0),
            pop3MaxDownload: Joi.number().min(0),

            tags: Joi.array().items(
                Joi.string()
                    .trim()
                    .max(128)
            ),

            disabled: Joi.boolean()
                .empty('')
                .truthy(['Y', 'true', 'yes', 1]),
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        if (result.value.forward) {
            result.value.forward = [].concat(result.value.forward || []).map(fwd => tools.normalizeAddress(fwd));
        }

        if (!result.value.targetUrl && 'targetUrl' in req.params) {
            result.value.targetUrl = '';
        }

        if (!result.value.name && 'name' in req.params) {
            result.value.name = '';
        }

        if (!result.value.pubKey && 'pubKey' in req.params) {
            result.value.pubKey = '';
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

        checkPubKey(result.value.pubKey, err => {
            if (err) {
                res.json({
                    error: 'PGP key validation failed. ' + err.message
                });
                return next();
            }

            userHandler.update(user, result.value, (err, success) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }
                res.json({
                    success
                });
                return next();
            });
        });
    });

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
    server.put('/users/:user/logout', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            reason: Joi.string()
                .empty('')
                .max(128),
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
                error: result.error.message
            });
            return next();
        }

        userHandler.logout(result.value.user, result.value.reason || 'Logout requested from API', (err, success) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            res.json({
                success
            });
            return next();
        });
    });

    /**
     * @api {post} /users/:id/quota/reset Recalculate User quota
     * @apiName PostUserQuota
     * @apiGroup Users
     * @apiDescription This method recalculates quota usage for an User. Normally not needed, only use it if quota numbers are way off.
     * This method is not transactional, so if the user is currently receiving new messages then the resulting value is not exact.
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
    server.post('/users/:user/quota/reset', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    storageUsed: true
                }
            },
            (err, userData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.messageusername
                    });
                    return next();
                }

                if (!userData) {
                    res.json({
                        error: 'This user does not exist'
                    });
                    return next();
                }

                // calculate mailbox size by aggregating the size's of all messages
                // NB! Scattered query
                db.database
                    .collection('messages')
                    .aggregate(
                        [
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
                        ],
                        {
                            cursor: {
                                batchSize: 1
                            }
                        }
                    )
                    .toArray((err, result) => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message
                            });
                            return next();
                        }

                        let storageUsed = (result && result[0] && result[0].storageUsed) || 0;

                        // update quota counter
                        db.users.collection('users').findOneAndUpdate(
                            {
                                _id: userData._id
                            },
                            {
                                $set: {
                                    storageUsed: Number(storageUsed) || 0
                                }
                            },
                            {
                                returnOriginal: false
                            },
                            (err, result) => {
                                if (err) {
                                    res.json({
                                        error: 'MongoDB Error: ' + err.message
                                    });
                                    return next();
                                }

                                if (!result || !result.value) {
                                    res.json({
                                        error: 'This user does not exist'
                                    });
                                    return next();
                                }

                                res.json({
                                    success: true,
                                    storageUsed: Number(result.value.storageUsed) || 0
                                });
                                return next();
                            }
                        );
                    });
            }
        );
    });

    /**
     * @api {post} /users/:id/password/reset Reset password for an User
     * @apiName ResetUserPassword
     * @apiGroup Users
     * @apiDescription This method generates a new temporary password for an User.
     * Additionally it removes all two-factor authentication settings
     *
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
    server.post('/users/:user/password/reset', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        userHandler.reset(user, result.value, (err, password) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            res.json({
                success: true,
                password
            });
            return next();
        });
    });

    /**
     * @api {delete} /users/:id Delete an User
     * @apiName DeleteUser
     * @apiGroup Users
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
    server.del('/users/:user', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
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
            res.json({
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        userHandler.delete(user, {}, (err, status) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            res.json({
                success: status
            });
            return next();
        });
    });
};

function getKeyInfo(pubKey) {
    if (!pubKey) {
        return false;
    }

    // try to encrypt something with that key
    let armored;
    try {
        armored = openpgp.key.readArmored(pubKey).keys;
    } catch (E) {
        return false;
    }

    if (!armored || !armored[0]) {
        return false;
    }

    let fingerprint = armored[0].primaryKey.fingerprint;
    let name, address;
    if (armored && armored[0] && armored[0].users && armored[0].users[0] && armored[0].users[0].userId) {
        let user = addressparser(armored[0].users[0].userId.userid);
        if (user && user[0] && user[0].address) {
            address = tools.normalizeAddress(user[0].address);
            try {
                name = libmime.decodeWords(user[0].name || '').trim();
            } catch (E) {
                // failed to parse value
                name = user[0].name || '';
            }
        }
    }

    return {
        name,
        address,
        fingerprint
    };
}

function checkPubKey(pubKey, done) {
    if (!pubKey) {
        return done();
    }

    // try to encrypt something with that key
    let armored;
    try {
        armored = openpgp.key.readArmored(pubKey).keys;
    } catch (E) {
        return done(E);
    }

    if (!armored || !armored[0]) {
        return done(new Error('Did not find key information'));
    }

    let fingerprint = armored[0].primaryKey.fingerprint;
    let name, address;
    if (armored && armored[0] && armored[0].users && armored[0].users[0] && armored[0].users[0].userId) {
        let user = addressparser(armored[0].users[0].userId.userid);
        if (user && user[0] && user[0].address) {
            address = tools.normalizeAddress(user[0].address);
            try {
                name = libmime.decodeWords(user[0].name || '').trim();
            } catch (E) {
                // failed to parse value
                name = user[0].name || '';
            }
        }
    }

    openpgp
        .encrypt({
            data: 'Hello, World!',
            publicKeys: armored
        })
        .then(ciphertext => {
            if (/^-----BEGIN PGP MESSAGE/.test(ciphertext.data)) {
                // everything checks out
                return done(null, {
                    address,
                    name,
                    fingerprint
                });
            }

            return done(new Error('Unexpected message'));
        })
        .catch(err => done(err));
}
