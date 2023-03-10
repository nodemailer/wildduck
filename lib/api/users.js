'use strict';

const log = require('npmlog');
const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const errors = require('../errors');
const openpgp = require('openpgp');
const BSON = require('bson');
const consts = require('../consts');
const roles = require('../roles');
const imapTools = require('../../imap-core/lib/imap-tools');
const pwnedpasswords = require('pwnedpasswords');
const { nextPageCursorSchema, previousPageCursorSchema, pageNrSchema, sessSchema, sessIPSchema, booleanSchema, metaDataSchema } = require('../schemas');
const TaskHandler = require('../task-handler');
const { publish, FORWARD_ADDED } = require('../events');
const { ExportStream, ImportStream } = require('../export');

const FEATURE_FLAGS = ['indexing'];

module.exports = (db, server, userHandler, settingsHandler) => {
    const taskHandler = new TaskHandler({ database: db.database });

    server.get(
        { name: 'users', path: '/users' },
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                query: Joi.string().empty('').lowercase().max(255),
                forward: Joi.string().empty('').lowercase().max(255),
                tags: Joi.string().trim().empty('').max(1024),
                requiredTags: Joi.string().trim().empty('').max(1024),
                metaData: booleanSchema,
                internalData: booleanSchema,
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
            }

            let permission;
            let ownOnly = false;
            permission = roles.can(req.role).readAny('userlisting');
            if (!permission.granted && req.user && ObjectId.isValid(req.user)) {
                permission = roles.can(req.role).readOwn('userlisting');
                if (permission.granted) {
                    ownOnly = true;
                }
            }
            // permissions check
            req.validate(permission);

            let query = result.value.query;
            let forward = result.value.forward;

            let limit = result.value.limit;
            let page = result.value.page;
            let pageNext = result.value.next;
            let pagePrevious = result.value.previous;

            let filter = query
                ? {
                      $or: [
                          {
                              address: {
                                  $regex: tools.escapeRegexStr(query),
                                  $options: ''
                              }
                          },
                          {
                              unameview: {
                                  $regex: tools.escapeRegexStr(tools.uview(query)),
                                  $options: ''
                              }
                          }
                      ]
                  }
                : {};

            if (forward) {
                filter['targets.value'] = {
                    $regex: tools.escapeRegexStr(forward),
                    $options: ''
                };
            }

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

            if (ownOnly) {
                filter._id = new ObjectId(req.user);
            }

            let total = await db.users.collection('users').countDocuments(filter);
            let opts = {
                limit,
                query: filter,
                fields: {
                    // FIXME: hack to keep _id in response
                    _id: true,
                    // FIXME: MongoPaging inserts fields value as second argument to col.find()
                    projection: {
                        _id: true,
                        username: true,
                        name: true,
                        address: true,
                        tags: true,
                        storageUsed: true,
                        enabled2fa: true,
                        autoreply: true,
                        targets: true,
                        quota: true,
                        activated: true,
                        disabled: true,
                        suspended: true,
                        password: true,
                        encryptMessages: true,
                        encryptForwarded: true
                    }
                },
                // _id gets removed in response if not explicitly set in paginatedField
                paginatedField: '_id',
                sortAscending: true
            };

            if (result.value.metaData) {
                opts.fields.projection.metaData = true;
            }

            if (result.value.internalData) {
                opts.fields.projection.internalData = true;
            }

            if (pageNext) {
                opts.next = pageNext;
            } else if ((!page || page > 1) && pagePrevious) {
                opts.previous = pagePrevious;
            }

            let listing;
            try {
                listing = await MongoPaging.find(db.users.collection('users'), opts);
            } catch (err) {
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let settings = await settingsHandler.getMulti(['const:max:storage']);

            let response = {
                success: true,
                query,
                total,
                page,
                previousCursor: listing.hasPrevious ? listing.previous : false,
                nextCursor: listing.hasNext ? listing.next : false,
                results: (listing.results || []).map(userData => {
                    let values = {
                        id: userData._id.toString(),
                        username: userData.username,
                        name: userData.name,
                        address: userData.address,
                        tags: userData.tags || [],
                        targets: userData.targets && userData.targets.map(target => target.value).filter(target => target),
                        enabled2fa: tools.getEnabled2fa(userData.enabled2fa),
                        autoreply: !!userData.autoreply,
                        encryptMessages: !!userData.encryptMessages,
                        encryptForwarded: !!userData.encryptForwarded,
                        quota: {
                            allowed: Number(userData.quota) || settings['const:max:storage'],
                            used: Math.max(Number(userData.storageUsed) || 0, 0)
                        },
                        hasPasswordSet: !!userData.password || !!userData.tempPassword,
                        activated: !!userData.activated,
                        disabled: !!userData.disabled,
                        suspended: !!userData.suspended
                    };

                    if (userData.metaData) {
                        values.metaData = tools.formatMetaData(userData.metaData);
                    }

                    if (userData.internalData) {
                        values.internalData = tools.formatMetaData(userData.internalData);
                    }

                    return permission.filter(values);
                })
            };

            return res.json(response);
        })
    );

    server.post(
        '/users',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                username: Joi.string()
                    .lowercase()
                    // no spaces, printable range
                    .regex(/^[\x21-\x7e]{1,128}?$/, 'username')
                    .min(1)
                    .max(128)
                    .required(),
                password: Joi.string().max(256).allow(false, '').required(),
                hashedPassword: booleanSchema.default(false),
                allowUnsafe: booleanSchema.default(true),

                address: Joi.string().email({ tlds: false }),
                emptyAddress: booleanSchema.default(false),

                language: Joi.string().empty('').max(20),

                retention: Joi.number().min(0).default(0),

                name: Joi.string().max(256),
                targets: Joi.array().items(
                    Joi.string().email({ tlds: false }),
                    Joi.string().uri({
                        scheme: [/smtps?/, /https?/],
                        allowRelative: false,
                        relativeOnly: false
                    })
                ),

                spamLevel: Joi.number().min(0).max(100).default(50),

                quota: Joi.number().min(0).default(0),
                recipients: Joi.number().min(0).default(0),
                forwards: Joi.number().min(0).default(0),

                filters: Joi.number().min(0).default(0),

                requirePasswordChange: booleanSchema.default(false),

                imapMaxUpload: Joi.number().min(0).default(0),
                imapMaxDownload: Joi.number().min(0).default(0),
                pop3MaxDownload: Joi.number().min(0).default(0),
                pop3MaxMessages: Joi.number().min(0).default(0),
                imapMaxConnections: Joi.number().min(0).default(0),
                receivedMax: Joi.number().min(0).default(0),

                fromWhitelist: Joi.array().items(Joi.string().trim().max(128)),

                tags: Joi.array().items(Joi.string().trim().max(128)),
                addTagsToAddress: booleanSchema.default(false),

                uploadSentMessages: booleanSchema.default(false),

                mailboxes: Joi.object().keys({
                    sent: Joi.string()
                        .empty('')
                        .regex(/\/{2,}|\/$/, { invert: true }),
                    trash: Joi.string()
                        .empty('')
                        .regex(/\/{2,}|\/$/, { invert: true }),
                    junk: Joi.string()
                        .empty('')
                        .regex(/\/{2,}|\/$/, { invert: true }),
                    drafts: Joi.string()
                        .empty('')
                        .regex(/\/{2,}|\/$/, { invert: true })
                }),

                disabledScopes: Joi.array()
                    .items(Joi.string().valid(...consts.SCOPES))
                    .unique()
                    .default([]),

                metaData: metaDataSchema.label('metaData'),
                internalData: metaDataSchema.label('internalData'),

                pubKey: Joi.string()
                    .empty('')
                    .trim()
                    .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format'),
                encryptMessages: booleanSchema.default(false),
                encryptForwarded: booleanSchema.default(false),

                featureFlags: Joi.object(Object.fromEntries(FEATURE_FLAGS.map(flag => [flag, booleanSchema.default(false)]))),

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

            if (result.value.password && !result.value.hashedPassword && !result.value.allowUnsafe) {
                try {
                    let count = await pwnedpasswords(result.value.password);
                    if (count) {
                        res.status(403);
                        return res.json({
                            error: 'Provided password was found from breached passwords list',
                            code: 'InsecurePasswordError'
                        });
                    }
                } catch (E) {
                    // ignore errors, soft check only
                }
            }

            let permission = roles.can(req.role).createAny('users');

            // permissions check
            req.validate(permission);

            // filter out unallowed fields
            let values = permission.filter(result.value);

            let targets = values.targets;

            if (targets) {
                for (let i = 0, len = targets.length; i < len; i++) {
                    let target = targets[i];
                    if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                        // email
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'mail',
                            value: target
                        };
                    } else if (/^smtps?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'relay',
                            value: target
                        };
                    } else if (/^https?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'http',
                            value: target
                        };
                    } else {
                        res.status(400);
                        return res.json({
                            error: 'Unknown target type "' + target + '"',
                            code: 'InputValidationError'
                        });
                    }
                }

                values.targets = targets;
            }

            if ('pubKey' in req.params && !values.pubKey) {
                values.pubKey = '';
            }

            if (values.tags) {
                let tagSeen = new Set();
                let tags = values.tags
                    .map(tag => tag.trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag.toLowerCase())) {
                            tagSeen.add(tag.toLowerCase());
                            return true;
                        }
                        return false;
                    })
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));

                values.tags = tags;
                values.tagsview = tags.map(tag => tag.toLowerCase());
            }

            if (values.username.indexOf('*') >= 0) {
                res.status(400);
                return res.json({
                    error: 'Invalid character in username: *',
                    code: 'InputValidationError'
                });
            }

            if (/^\.|\.$|\.{2,}/g.test(values.username) || !/[^.]/.test(values.username)) {
                res.status(400);
                return res.json({
                    error: 'Invalid dot symbols in username',
                    code: 'InputValidationError'
                });
            }

            if (values.address && values.address.indexOf('*') >= 0) {
                res.status(400);
                return res.json({
                    error: 'Invalid character in email address: *',
                    code: 'InputValidationError'
                });
            }

            if (values.fromWhitelist && values.fromWhitelist.length) {
                values.fromWhitelist = Array.from(new Set(values.fromWhitelist.map(address => tools.normalizeAddress(address))));
            }

            if (values.mailboxes) {
                let seen = new Set(['INBOX']);
                for (let key of ['sent', 'junk', 'trash', 'drafts']) {
                    if (!values.mailboxes[key]) {
                        continue;
                    }
                    values.mailboxes[key] = imapTools.normalizeMailbox(values.mailboxes[key]);
                    if (seen.has(values.mailboxes[key])) {
                        res.status(400);
                        return res.json({
                            error: 'Duplicate mailbox name: ' + values.mailboxes[key],
                            code: 'InputValidationError'
                        });
                    }
                    seen.add(values.mailboxes[key]);

                    // rename key to use specialUse format ("seen"->"\\Seen")
                    delete values.mailboxes[key];
                    values.mailboxes[key.replace(/^./, c => '\\' + c.toUpperCase())] = values.mailboxes[key];
                }
            }

            try {
                await getKeyInfo(values.pubKey);
            } catch (err) {
                res.status(400);
                return res.json({
                    error: 'PGP key validation failed. ' + err.message,
                    code: 'InputValidationError'
                });
            }

            let user;
            try {
                user = await userHandler.create(values);
            } catch (err) {
                log.error('API', err);
                res.status(500); // TODO: use response code specific status
                return res.json({
                    error: err.message,
                    code: err.code,
                    username: values.username
                });
            }

            if (targets) {
                for (let target of targets) {
                    // log as new redirect targets
                    try {
                        await userHandler.logAuthEvent(user, {
                            action: 'user forward added',
                            result: 'success',
                            target: target.value,
                            protocol: 'API',
                            sess: values.sess,
                            ip: values.ip
                        });
                    } catch (err) {
                        // ignore
                        log.error('API', err);
                    }

                    await publish(db.redis, {
                        ev: FORWARD_ADDED,
                        user,
                        type: 'user',
                        target: target.value
                    });
                }
            }

            return res.json({
                success: !!user,
                id: user
            });
        })
    );

    server.get(
        '/users/resolve/:username',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                username: Joi.string()
                    .lowercase()
                    .regex(/^[a-z0-9][a-z0-9.]+[a-z0-9]$/, 'username')
                    .min(3)
                    .max(32)
                    .required(),
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
            req.validate(roles.can(req.role).readAny('users'));

            let username = result.value.username;

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        unameview: username.replace(/\./g, '')
                    },
                    {
                        projection: {
                            _id: true
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

            return res.json({
                success: true,
                id: userData._id.toString()
            });
        })
    );

    server.get(
        '/users/:user',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
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
            let permission;
            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).readOwn('users');
            } else {
                permission = roles.can(req.role).readAny('users');
            }
            req.validate(permission);

            let user = new ObjectId(result.value.user);

            let userData;

            try {
                userData = await db.users.collection('users').findOne({
                    _id: user
                });
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

            let response;
            try {
                response = await db.redis
                    .multi()
                    // sending counters are stored in Redis

                    // sent messages
                    .get('wdr:' + userData._id.toString())
                    .ttl('wdr:' + userData._id.toString())

                    // forwarded messages
                    .get('wdf:' + userData._id.toString())
                    .ttl('wdf:' + userData._id.toString())

                    //  rate limited recipient
                    .get('rl:rcpt:' + userData._id.toString())
                    .ttl('rl:rcpt:' + userData._id.toString())

                    //  rate limited imap uploads
                    .get('iup:' + userData._id.toString())
                    .ttl('iup:' + userData._id.toString())

                    //  rate limited imap downloads
                    .get('idw:' + userData._id.toString())
                    .ttl('idw:' + userData._id.toString())

                    //  rate limited pop3 downloads
                    .get('pdw:' + userData._id.toString())
                    .ttl('pdw:' + userData._id.toString())

                    .hget('lim:imap', userData._id.toString())

                    .exec();
            } catch (err) {
                // ignore
                errors.notify(err, { userId: user });
            }

            const filtersCount = await db.database.collection('filters').countDocuments({
                user
            });

            let settings = await settingsHandler.getMulti([
                'const:max:storage',
                'const:max:recipients',
                'const:max:forwards',
                'const:max:filters',
                'const:max:imap:upload',
                'const:max:imap:download',
                'const:max:pop3:download'
            ]);

            let recipients = Number(userData.recipients) || config.maxRecipients || settings['const:max:recipients'];
            let forwards = Number(userData.forwards) || config.maxForwards || settings['const:max:forwards'];

            let filters = Number(userData.filters) || settings['const:max:filters'];

            let recipientsSent = Number(response && response[0] && response[0][1]) || 0;
            let recipientsTtl = Number(response && response[1] && response[1][1]) || 0;

            let forwardsSent = Number(response && response[2] && response[2][1]) || 0;
            let forwardsTtl = Number(response && response[3] && response[3][1]) || 0;

            let received = Number(response && response[4] && response[4][1]) || 0;
            let receivedTtl = Number(response && response[5] && response[5][1]) || 0;

            let imapUpload = Number(response && response[6] && response[6][1]) || 0;
            let imapUploadTtl = Number(response && response[7] && response[7][1]) || 0;

            let imapDownload = Number(response && response[8] && response[8][1]) || 0;
            let imapDownloadTtl = Number(response && response[9] && response[9][1]) || 0;

            let pop3Download = Number(response && response[10] && response[10][1]) || 0;
            let pop3DownloadTtl = Number(response && response[11] && response[11][1]) || 0;

            let imapMaxConnections = Number(response && response[12] && response[12][1]) || 0;

            let keyInfo;
            try {
                keyInfo = await getKeyInfo(userData.pubKey);
            } catch (err) {
                errors.notify(err, { userId: user, source: 'pgp' });
            }

            return res.json(
                permission.filter({
                    success: true,
                    id: user.toString(),

                    username: userData.username,
                    name: userData.name,

                    address: userData.address,

                    language: userData.language,
                    retention: userData.retention || false,

                    enabled2fa: tools.getEnabled2fa(userData.enabled2fa),
                    autoreply: !!userData.autoreply,

                    encryptMessages: userData.encryptMessages,
                    encryptForwarded: userData.encryptForwarded,
                    pubKey: userData.pubKey,
                    spamLevel: userData.spamLevel,
                    keyInfo,

                    metaData: tools.formatMetaData(userData.metaData),
                    internalData: tools.formatMetaData(userData.internalData),

                    targets: []
                        .concat(userData.targets || [])
                        .map(target => target.value)
                        .filter(target => target),

                    limits: {
                        quota: {
                            allowed: Number(userData.quota) || settings['const:max:storage'],
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
                        },

                        received: {
                            allowed: Number(userData.receivedMax) || 60,
                            used: received,
                            ttl: receivedTtl >= 0 ? receivedTtl : false
                        },

                        filters: {
                            allowed: filters,
                            used: filtersCount
                        },

                        imapUpload: {
                            allowed: Number(userData.imapMaxUpload) || settings['const:max:imap:upload'],
                            used: imapUpload,
                            ttl: imapUploadTtl >= 0 ? imapUploadTtl : false
                        },

                        imapDownload: {
                            allowed: Number(userData.imapMaxDownload) || settings['const:max:imap:download'],
                            used: imapDownload,
                            ttl: imapDownloadTtl >= 0 ? imapDownloadTtl : false
                        },

                        pop3Download: {
                            allowed: Number(userData.pop3MaxDownload) || settings['const:max:pop3:download'],
                            used: pop3Download,
                            ttl: pop3DownloadTtl >= 0 ? pop3DownloadTtl : false
                        },

                        pop3MaxMessages: {
                            allowed: Number(userData.pop3MaxMessages) || config.pop3.maxMessages
                        },

                        imapMaxConnections: {
                            allowed: Number(userData.imapMaxConnections) || config.imap.maxConnections,
                            used: imapMaxConnections
                        }
                    },

                    tags: userData.tags || [],

                    fromWhitelist: userData.fromWhitelist || [],

                    disabledScopes: userData.disabledScopes || [],

                    hasPasswordSet: !!userData.password || !!userData.tempPassword,
                    activated: !!userData.activated,
                    disabled: !!userData.disabled,
                    suspended: !!userData.suspended
                })
            );
        })
    );

    server.put(
        '/users/:user',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),

                existingPassword: Joi.string().empty('').min(1).max(256),

                password: Joi.string().max(256).allow(false, ''),
                hashedPassword: booleanSchema.default(false),
                allowUnsafe: booleanSchema.default(true),

                language: Joi.string().empty('').max(20),

                name: Joi.string().empty('').max(256),
                targets: Joi.array().items(
                    Joi.string().email({ tlds: false }),
                    Joi.string().uri({
                        scheme: [/smtps?/, /https?/],
                        allowRelative: false,
                        relativeOnly: false
                    })
                ),

                spamLevel: Joi.number().min(0).max(100),

                uploadSentMessages: booleanSchema.default(false),

                fromWhitelist: Joi.array().items(Joi.string().trim().max(128)),

                metaData: metaDataSchema.label('metaData'),
                internalData: metaDataSchema.label('internalData'),

                pubKey: Joi.string()
                    .empty('')
                    .trim()
                    .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format'),
                encryptMessages: booleanSchema,
                encryptForwarded: booleanSchema,
                retention: Joi.number().min(0),

                quota: Joi.number().min(0),
                recipients: Joi.number().min(0),
                forwards: Joi.number().min(0),

                filters: Joi.number().min(0),

                imapMaxUpload: Joi.number().min(0),
                imapMaxDownload: Joi.number().min(0),
                pop3MaxDownload: Joi.number().min(0),
                pop3MaxMessages: Joi.number().min(0),
                imapMaxConnections: Joi.number().min(0),

                receivedMax: Joi.number().min(0),

                disable2fa: booleanSchema,

                tags: Joi.array().items(Joi.string().trim().max(128)),

                disabledScopes: Joi.array()
                    .items(Joi.string().valid(...consts.SCOPES))
                    .unique(),

                disabled: booleanSchema,

                featureFlags: Joi.object(Object.fromEntries(FEATURE_FLAGS.map(flag => [flag, booleanSchema.default(false)]))),

                suspended: booleanSchema,

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
            let permission;
            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).updateOwn('users');
            } else {
                permission = roles.can(req.role).updateAny('users');
            }
            req.validate(permission);

            let values = permission.filter(result.value);

            if (values.password && !values.hashedPassword && !values.allowUnsafe) {
                try {
                    let count = await pwnedpasswords(values.password);
                    if (count) {
                        res.status(403);
                        return res.json({
                            error: 'Provided password was found from breached passwords list',
                            code: 'InsecurePasswordError'
                        });
                    }
                } catch (E) {
                    // ignore errors, soft check only
                }
            }

            let user = new ObjectId(values.user);

            let targets = values.targets;
            let existingTargets;

            if (targets) {
                for (let i = 0, len = targets.length; i < len; i++) {
                    let target = targets[i];
                    if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                        // email
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'mail',
                            value: target
                        };
                    } else if (/^smtps?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'relay',
                            value: target
                        };
                    } else if (/^https?:/i.test(target)) {
                        targets[i] = {
                            id: new ObjectId(),
                            type: 'http',
                            value: target
                        };
                    } else {
                        res.status(400);
                        return res.json({
                            error: 'Unknown target type "' + target + '"',
                            code: 'InputValidationError'
                        });
                    }
                }

                values.targets = targets;

                let existingUserData;
                try {
                    existingUserData = await db.users.collection('users').findOne(
                        {
                            _id: user
                        },
                        {
                            projection: {
                                targets: true
                            }
                        }
                    );
                    existingTargets = (existingUserData.targets || []).map(target => target.value);
                } catch (err) {
                    res.status(500);
                    return res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                }
            }

            if (!values.name && 'name' in req.params) {
                values.name = '';
            }

            if (!values.pubKey && 'pubKey' in req.params) {
                values.pubKey = '';
            }

            if (values.tags) {
                let tagSeen = new Set();
                let tags = values.tags
                    .map(tag => tag.trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag.toLowerCase())) {
                            tagSeen.add(tag.toLowerCase());
                            return true;
                        }
                        return false;
                    })
                    .sort((a, b) => a.toLowerCase().localeCompare(b.toLowerCase()));
                values.tags = tags;
                values.tagsview = tags.map(tag => tag.toLowerCase());
            }

            if (values.fromWhitelist && values.fromWhitelist.length) {
                values.fromWhitelist = Array.from(new Set(values.fromWhitelist.map(address => tools.normalizeAddress(address))));
            }

            try {
                await getKeyInfo(values.pubKey);
            } catch (err) {
                res.status(400);
                return res.json({
                    error: 'PGP key validation failed. ' + err.message,
                    code: 'InputValidationError'
                });
            }

            let updateResponse;
            try {
                updateResponse = await userHandler.update(user, values);
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            let { success, passwordChanged } = updateResponse || {};
            if (passwordChanged && req.accessToken && typeof req.accessToken.update === 'function') {
                try {
                    // update access token data for current session after password change
                    await req.accessToken.update();
                } catch (err) {
                    // ignore
                }
            }

            // compare new forwards against existing ones
            if (targets) {
                for (let target of targets) {
                    if (!existingTargets.includes(target.value)) {
                        // found new forward
                        try {
                            await userHandler.logAuthEvent(user, {
                                action: 'user forward added',
                                result: 'success',
                                target: target.value,
                                protocol: 'API',
                                sess: values.sess,
                                ip: values.ip
                            });
                        } catch (err) {
                            // ignore
                            log.error('API', err);
                        }

                        await publish(db.redis, {
                            ev: FORWARD_ADDED,
                            user,
                            type: 'user',
                            target: target.value
                        });
                    }
                }
            }

            return res.json({
                success
            });
        })
    );

    server.put(
        '/users/:user/logout',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                reason: Joi.string().empty('').max(128),
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
                req.validate(roles.can(req.role).readOwn('users'));
            } else {
                req.validate(roles.can(req.role).readAny('users'));
            }

            let success;
            try {
                success = await userHandler.logout(result.value.user, result.value.reason || 'Logout requested from API');
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            return res.json({
                success
            });
        })
    );

    server.post(
        '/users/:user/quota/reset',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
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
                req.validate(roles.can(req.role).updateOwn('users'));
            } else {
                req.validate(roles.can(req.role).updateAny('users'));
            }

            let user = new ObjectId(result.value.user);

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
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
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
                        returnDocument: 'before',
                        projection: {
                            storageUsed: true
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

            if (!updateResponse || !updateResponse.value) {
                res.status(404);
                return res.json({
                    error: 'This user does not exist',
                    code: 'UserNotFound'
                });
            }

            server.loggelf({
                short_message: '[QUOTA] reset',
                _mail_action: 'quota',
                _user: userData._id,
                _set: Number(storageUsed) || 0,
                _previous_storage_used: Number(updateResponse.value.storageUsed) || 0,
                _storage_used: Number(storageUsed) || 0
            });

            return res.json({
                success: true,
                storageUsed: Number(storageUsed) || 0,
                previousStorageUsed: Number(updateResponse.value.storageUsed) || 0
            });
        })
    );

    server.post(
        '/quota/reset',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
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
            req.validate(roles.can(req.role).updateAny('users'));

            let task;
            try {
                task = await taskHandler.add('quota', {});
            } catch (err) {
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            return res.json({
                success: true,
                task
            });
        })
    );

    server.post(
        '/data/export',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                users: Joi.array().single().items(Joi.string().hex().lowercase().length(24).required()),
                tags: Joi.array().single().items(Joi.string().trim().empty('').max(1024)),
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
            req.validate(roles.can(req.role).createAny('export'));

            let exporter = new ExportStream({
                type: 'wildduck_data_export',
                users: result.value.users,
                tags: result.value.tags
            });

            const runUserExport = async (user, exporter) => {
                log.info('Export', `Processing user ${user}`);

                const processCollection = async (client, collection, query) => {
                    let cursor = await db[client].collection(collection).find(query, {
                        raw: true
                    });
                    let entry;
                    let rowcount = 0;
                    while ((entry = await cursor.next())) {
                        exporter.write({ client, collection, entry });
                        rowcount++;
                    }
                    await cursor.close();
                    log.info('Export', `Exported ${rowcount} rows from ${client}.${collection} for user ${user}`);
                };

                await processCollection('users', 'users', { _id: user });
                await processCollection('users', 'addresses', { user });
                await processCollection('users', 'asps', { user });

                await processCollection('database', 'addressregister', { user });
                await processCollection('database', 'autoreplies', { user });
                await processCollection('database', 'filters', { user });
                await processCollection('database', 'mailboxes', { user });
            };

            const runExport = async (query = {}, exporter) => {
                let filter = {};

                if (query.users) {
                    filter._id = { $in: query.users.map(user => new ObjectId(user)) };
                }

                let tagSeen = new Set();

                let tags = (query.tags || [])
                    .map(tag => tag.toLowerCase().trim())
                    .filter(tag => {
                        if (tag && !tagSeen.has(tag)) {
                            tagSeen.add(tag);
                            return true;
                        }
                        return false;
                    });

                if (tags.length) {
                    filter.tagsview = { $in: tags };
                }

                let userIds = await db.users
                    .collection('users')
                    .find(filter, { projection: { _id: true } })
                    .toArray();

                for (let { _id: user } of userIds) {
                    await runUserExport(user, exporter);
                }

                exporter.end();
            };

            res.writeHead(200, {
                'Content-Type': 'application/octet-stream'
            });

            exporter.pipe(res);

            try {
                await new Promise((resolve, reject) => {
                    exporter.on('error', err => {
                        reject(err);
                    });

                    runExport(result.value, exporter).then(resolve).catch(reject);
                });
                log.info('API', `Export completed`);
            } catch (err) {
                log.error('API', `Export failed: ${err.stack}`);
                res.write(`\nExport failed\n${err.message}\n${err.code || 'Error'}\n`);
                res.end();
            }
        })
    );

    server.post(
        '/data/import',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            // permissions check
            req.validate(roles.can(req.role).createAny('import'));

            let result;

            try {
                result = await new Promise((resolve, reject) => {
                    let importer = new ImportStream();

                    importer.once('error', err => {
                        reject(err);
                    });

                    let canImport = false;

                    importer.on('header', header => {
                        canImport = header && header.type === 'wildduck_data_export';
                        if (!canImport) {
                            let err = new Error('Invalid data file');
                            err.code = 'INVALID_DATA';
                            reject(err);
                        }
                    });

                    let reading = false;
                    let ended = false;

                    let result = {
                        entries: 0,
                        imported: 0,
                        failed: 0,
                        existing: 0
                    };

                    importer.on('readable', () => {
                        if (reading) {
                            return;
                        }
                        reading = true;

                        let readNextEntry = () => {
                            let entry = importer.read();
                            if (entry === null) {
                                reading = false;
                                if (ended) {
                                    resolve(result);
                                }
                                return;
                            }
                            if (!canImport) {
                                // flush data
                                return setImmediate(readNextEntry);
                            }

                            result.entries++;

                            if (['database', 'users', 'gridfs', 'senderDb'].includes(entry.client)) {
                                let document = BSON.deserialize(entry.entry);
                                if (!document) {
                                    log.error('Import', 'Can not import empty document client=%s collection=%s', entry.client, entry.collection);
                                    return setImmediate(readNextEntry);
                                }

                                // we do not import data, only account info, so reset all storage info to 0
                                switch (entry.collection) {
                                    case 'users':
                                        document.storageUsed = 0;
                                        break;

                                    case 'mailboxes':
                                        document.uidValidity = Math.floor(Date.now() / 1000);
                                        document.uidNext = 1;
                                        document.modifyIndex = 0;
                                        break;
                                }

                                return db[entry.client].collection(entry.collection).insertOne(document, {}, (err, res) => {
                                    if (err) {
                                        switch (err.code) {
                                            case 11000:
                                                result.existing++;
                                                log.info(
                                                    'Import',
                                                    'resolution=%s client=%s collection=%s _id=%s',
                                                    'existing',
                                                    entry.client,
                                                    entry.collection,
                                                    document._id
                                                );
                                                break;
                                            default:
                                                result.failed++;
                                                log.error(
                                                    'Import',
                                                    'resolution=%s client=%s collection=%s _id=%s error=%s',
                                                    'failed',
                                                    entry.client,
                                                    entry.collection,
                                                    document._id,
                                                    err.message
                                                );
                                        }
                                        return setImmediate(readNextEntry);
                                    }

                                    if (res && res.insertedId) {
                                        result.imported++;
                                        log.info(
                                            'Import',
                                            'resolution=%s client=%s collection=%s _id=%s',
                                            'imported',
                                            entry.client,
                                            entry.collection,
                                            res.insertedId
                                        );
                                    } else {
                                        log.info(
                                            'Import',
                                            'resolution=%s client=%s collection=%s _id=%s',
                                            'skipped',
                                            entry.client,
                                            entry.collection,
                                            document._id
                                        );
                                    }

                                    return setImmediate(readNextEntry);
                                });
                            } else {
                                log.info('Import', 'Can not import document client=%s collection=%s', entry.client, entry.collection);
                            }
                            return setImmediate(readNextEntry);
                        };

                        readNextEntry();
                    });

                    importer.once('end', () => {
                        ended = true;
                        if (reading) {
                            return;
                        }
                        resolve(result);
                    });

                    req.once('error', err => {
                        reject(err);
                    });

                    req.pipe(importer);
                });
            } catch (err) {
                res.status(500);
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            return res.json({
                result
            });
        })
    );

    server.post(
        '/users/:user/password/reset',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                validAfter: Joi.date().empty('').allow(false),
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
            req.validate(roles.can(req.role).updateAny('users'));

            let user = new ObjectId(result.value.user);

            let password;
            try {
                password = await userHandler.reset(user, result.value);
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            return res.json({
                success: true,
                password,
                validAfter: (result.value && result.value.validAfter) || new Date()
            });
        })
    );

    server.del(
        '/users/:user',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                deleteAfter: Joi.date().empty('').allow(false).default(false),
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
            req.validate(roles.can(req.role).deleteAny('users'));

            let user = new ObjectId(result.value.user);

            let deleteResponse;
            try {
                deleteResponse = await userHandler.delete(user, Object.assign({}, result.value));
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            return res.json(
                Object.assign(
                    {
                        success: !!deleteResponse,
                        code: 'TaskScheduled'
                    },
                    deleteResponse || {}
                )
            );
        })
    );

    server.get(
        '/users/:user/restore',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
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
                req.validate(roles.can(req.role).readOwn('users'));
            } else {
                req.validate(roles.can(req.role).readAny('users'));
            }

            let user = new ObjectId(result.value.user);

            let userInfo;
            try {
                userInfo = await userHandler.restoreInfo(user);
            } catch (err) {
                res.status(err.responseCode || 500); // TODO: use response code specific status
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            return res.json(
                Object.assign(
                    {
                        success: !!userInfo
                    },
                    userInfo
                )
            );
        })
    );

    server.post(
        '/users/:user/restore',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
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
                req.validate(roles.can(req.role).updateOwn('users'));
            } else {
                req.validate(roles.can(req.role).updateAny('users'));
            }

            let user = new ObjectId(result.value.user);

            let task;
            try {
                task = await userHandler.restore(user, Object.assign({}, result.value));
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                return res.json({
                    error: err.message,
                    code: err.code
                });
            }

            return res.json(
                Object.assign(
                    {
                        success: !!task,
                        code: task && task.task ? 'TaskCancelled' : 'RequestProcessed'
                    },
                    task || {}
                )
            );
        })
    );
};

async function getKeyInfo(pubKeyArmored) {
    if (!pubKeyArmored) {
        return false;
    }

    let pubKey = await openpgp.readKey({ armoredKey: tools.prepareArmoredPubKey(pubKeyArmored), config: { tolerant: true } });
    if (!pubKey) {
        throw new Error('Failed to process public key');
    }

    let fingerprint = pubKey.getFingerprint();
    let { name, address } = tools.getPGPUserId(pubKey);

    let ciphertext = await openpgp.encrypt({
        message: await openpgp.createMessage({ text: 'Hello, World!' }),
        encryptionKeys: pubKey, // for encryption
        format: 'armored',
        config: { minRSABits: 1024 }
    });

    if (/^-----BEGIN PGP MESSAGE/.test(ciphertext)) {
        // everything checks out
        return {
            name,
            address,
            fingerprint
        };
    }

    throw new Error('Failed to verify public key');
}
