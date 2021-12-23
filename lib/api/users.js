'use strict';

const log = require('npmlog');
const config = require('wild-config');
const Joi = require('joi');
const MongoPaging = require('mongo-cursor-pagination');
const ObjectId = require('mongodb').ObjectId;
const Boom = require('@hapi/boom');
const errors = require('../errors');
const consts = require('../consts');
const roles = require('../roles');
const imapTools = require('../../imap-core/lib/imap-tools');

const { getKeyInfo, escapeRegexStr, uview, formatMetaData, failAction, normalizeAddress } = require('../tools');
const {
    nextPageCursorSchema,
    previousPageCursorSchema,
    pageNrSchema,
    sessSchema,
    sessIPSchema,
    booleanSchema,
    metaDataSchema,
    tagsSchema,
    tagsArraySchema,
    forwardTargetSchema,
    userIdSchema,
    userUsernameSchema,
    pageLimitSchema,
    userNameSchema,
    locationSchema,
    languageSchema
} = require('../schemas');
//const TaskHandler = require('../task-handler');
const { publish, FORWARD_ADDED } = require('../events');

module.exports = (server, db, userHandler, settingsHandler) => {
    //const taskHandler = new TaskHandler({ database: db.database });

    server.route({
        method: 'GET',
        path: '/users',

        async handler(request) {
            // permissions check
            let permission;
            let ownOnly = false;
            permission = roles.can(request.app.role).readAny('userlisting');
            if (!permission.granted && request.app.user) {
                permission = roles.can(request.app.role).readOwn('userlisting');
                if (permission.granted) {
                    ownOnly = true;
                }
            }
            request.validateAcl(permission);

            let query = request.query.query;
            let forward = request.query.forward;

            let limit = request.query.limit;
            let page = request.query.page;
            let pageNext = request.query.next;
            let pagePrevious = request.query.previous;

            let filter = query
                ? {
                      $or: [
                          {
                              address: {
                                  $regex: escapeRegexStr(query),
                                  $options: ''
                              }
                          },
                          {
                              unameview: {
                                  $regex: escapeRegexStr(uview(query)),
                                  $options: ''
                              }
                          }
                      ]
                  }
                : {};

            if (forward) {
                filter['targets.value'] = {
                    $regex: escapeRegexStr(forward),
                    $options: ''
                };
            }

            let requiredTags = (request.query.requiredTags || '').split(',').filter(tag => tag);
            let tags = (request.query.tags || '').split(',').filter(tag => tag);

            let tagsview = {};
            if (requiredTags.length) {
                tagsview.$all = requiredTags.map(tag => tag.toLowerCase());
            }

            if (tags.length) {
                tagsview.$in = tags.map(tag => tag.toLowerCase());
            }

            if (requiredTags.length || tags.length) {
                filter.tagsview = tagsview;
            }

            if (ownOnly) {
                filter._id = new ObjectId(request.app.user);
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

            if (request.query.metaData) {
                opts.fields.projection.metaData = true;
            }

            if (request.query.internalData) {
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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!listing.hasPrevious) {
                page = 1;
            }

            let settings = await settingsHandler.getMulti(['const:max:storage']);

            let response = {
                success: true,
                queryOpts: opts,
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
                        targets: userData.targets && userData.targets.map(t => t.value),
                        enabled2fa: Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []),
                        autoreply: !!userData.autoreply,
                        encryptMessages: !!userData.encryptMessages,
                        encryptForwarded: !!userData.encryptForwarded,
                        quota: {
                            allowed: Number(userData.quota) || (config.maxStorage ? config.maxStorage * 1024 * 1024 : settings['const:max:storage']),
                            used: Math.max(Number(userData.storageUsed) || 0, 0)
                        },
                        hasPasswordSet: !!userData.password || !!userData.tempPassword,
                        activated: !!userData.activated,
                        disabled: !!userData.disabled,
                        suspended: !!userData.suspended
                    };

                    if (userData.metaData) {
                        values.metaData = formatMetaData(userData.metaData);
                    }

                    if (userData.internalData) {
                        values.internalData = formatMetaData(userData.internalData);
                    }

                    return permission.filter(values);
                })
            };

            return response;
        },

        options: {
            description: 'List registered users',
            notes: 'List registered user accounts',
            tags: ['api', 'Users'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                query: Joi.object({
                    query: Joi.string().empty('').lowercase().max(255).description('Partial match of username or default email address'),
                    forward: Joi.string().empty('').lowercase().max(255).description('Partial match of a forward email address or URL'),
                    tags: tagsSchema.empty('').description('Comma separated list of tags. The user must have at least one to be set'),
                    requiredTags: tagsSchema.empty('').description('Comma separated list of tags. The user must have all listed tags to be set'),
                    metaData: booleanSchema.description('If true, then includes metaData in the response'),
                    internalData: booleanSchema.description('If true, then includes internalData in the response. Not shown for user-role tokens.'),

                    limit: pageLimitSchema,
                    next: nextPageCursorSchema,
                    previous: previousPageCursorSchema,
                    page: pageNrSchema,
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('ListUsersQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    query: Joi.string().example('example.com').description('Partial hostname match'),
                    total: Joi.number().required().example(123).description('How many DKIM certificates wer found'),
                    page: Joi.number().required().example(1).description('Current response page'),
                    previousCursor: previousPageCursorSchema.allow(false),
                    nextCursor: nextPageCursorSchema.allow(false),
                    results: Joi.array()
                        .items(
                            Joi.object({
                                id: userIdSchema,
                                username: userUsernameSchema.description('Username'),
                                name: userNameSchema,
                                address: Joi.string().email().example('john@example.com').description('Default email address of the user'),
                                tags: tagsSchema.example('status:user, account:example.com').description('A list of tags associated with the user'),
                                targets: forwardTargetSchema,
                                enabled2fa: Joi.array()
                                    .items(Joi.string().valid('totp', 'u2f', 'custom'))
                                    .description('A list of enabled two-factor authentication schemes'),
                                autoreply: booleanSchema.description(
                                    'Is autoreply enabled or not (start time may still be in the future or end time in the past)'
                                ),
                                encryptMessages: booleanSchema.description('Are messages automatically encrypted'),
                                encryptForwarded: booleanSchema.description('Are forwarded messages encrypted'),
                                quota: Joi.object({
                                    allowed: Joi.number()
                                        .example(1024 * 1024 * 1024)
                                        .description('Maximum allowed storage in bytes'),
                                    used: Joi.number()
                                        .example(512 * 1024)
                                        .description('Currently used storage in bytes')
                                }).description('User quota usage'),
                                hasPasswordSet: booleanSchema.description('Does the user have a password set'),
                                activated: booleanSchema.description('Is the account activated'),
                                disabled: booleanSchema.description(
                                    'Is the account disabled or not. Disabled user can not authenticate or receive any new mail'
                                ),
                                suspended: booleanSchema.description(
                                    'Is the account suspended or not. Suspended user can not authenticate, but they can receive mail'
                                ),
                                metaData: Joi.object().description('Custom metadata value. Included if "metaData" query argument was "true"'),
                                internalData: Joi.object().description(
                                    'Custom metadata value for internal use. Included if "internalData" query argument was "true" and request was not made using a user-role token'
                                )
                            }).label('UsersListItem')
                        )
                        .description('Result listing')
                        .label('UsersListItems')
                }).label('ListUsersQueryReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'POST',
        path: '/users',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).createAny('dkim');
            request.validateAcl(permission);

            // filter out unallowed fields
            let values = permission.filter(request.payload);

            // reformat targets array
            if (values.targets && values.targets.length) {
                values.targets = values.targets
                    .map(target => {
                        if (!/^smtps?:/i.test(target) && !/^https?:/i.test(target) && target.indexOf('@') >= 0) {
                            // email
                            return {
                                id: new ObjectId(),
                                type: 'mail',
                                value: target
                            };
                        } else if (/^smtps?:/i.test(target)) {
                            return {
                                id: new ObjectId(),
                                type: 'relay',
                                value: target
                            };
                        } else if (/^https?:/i.test(target)) {
                            return {
                                id: new ObjectId(),
                                type: 'http',
                                value: target
                            };
                        }
                    })
                    .filter(target => target);
            }

            if (values.tags) {
                values.tagsview = values.tags.map(tag => tag.toLowerCase());
            }

            if (values.fromWhitelist && values.fromWhitelist.length) {
                values.fromWhitelist = Array.from(new Set(values.fromWhitelist.map(address => normalizeAddress(address))));
            }

            if (values.mailboxes) {
                let seen = new Set(['INBOX']);
                for (let key of ['sent', 'junk', 'trash', 'drafts']) {
                    if (!values.mailboxes[key]) {
                        continue;
                    }
                    values.mailboxes[key] = imapTools.normalizeMailbox(values.mailboxes[key]);
                    if (seen.has(values.mailboxes[key])) {
                        let error = Boom.boomify(new Error('Duplicate mailbox name: ' + values.mailboxes[key]), { statusCode: 400 });
                        error.output.payload.code = 'InputValidationError';
                        throw error;
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
                let error = Boom.boomify(new Error('PGP key validation failed. ' + err.message), { statusCode: 400 });
                error.output.payload.code = 'InputValidationError';
                throw error;
            }

            let user;
            try {
                user = await userHandler.create(values);
            } catch (err) {
                log.error('API', err);
                let error = Boom.boomify(err, { statusCode: err.responseCode || 500 });
                error.output.payload.code = err.code;
                error.output.payload.username = values.username;
                throw error;
            }

            if (values.targets) {
                for (let target of values.targets) {
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

            return {
                success: !!user,
                id: user
            };
        },

        options: {
            description: 'Create a user',
            notes: 'Create a new user account',
            tags: ['api', 'Users'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                payload: Joi.object({
                    username: userUsernameSchema
                        .required()
                        .description('Username of the user. Dots are allowed but informational only ("user.name" is the same as "username").'),

                    name: userNameSchema,

                    address: Joi.string()
                        .email({ tlds: false })
                        .example('john@example.com')
                        .description('Default email address for the user (autogenerated if not set)'),

                    password: Joi.string()
                        .max(1024)
                        .allow(false, '')
                        .required()
                        .example('secretvalue')
                        .description(
                            'Password for the user. Set to boolean "false" to disable password usage for the master scope. Application Specific Passwords would still be allowed.'
                        ),

                    hashedPassword: booleanSchema
                        .default(false)
                        .example(false)
                        .description(
                            'If "true" then password is already hashed, so store it as it is. Supported hashes: "pbkdf2", "bcrypt" ($2a, $2y, $2b), "md5" ($1), "sha512" ($6), sha256 ($5), "argon2" ($argon2d, $argon2i, $argon2id). Stored hashes are rehashed to "pbkdf2" on first successful password check.'
                        ),

                    emptyAddress: booleanSchema
                        .default(false)
                        .example(false)
                        .description(
                            'If "true" then do not autogenerate missing email address for the user. Only needed if you want to create a user account that does not have any email address associated.'
                        ),

                    language: languageSchema.empty(''),
                    location: locationSchema.empty(''),

                    retention: Joi.number()
                        .allow(false)
                        .min(0)
                        .default(0)
                        .example(0)
                        .description('Default retention time (in ms). Set to 0 or false to disable.'),

                    targets: forwardTargetSchema,

                    spamLevel: Joi.number()
                        .min(0)
                        .max(100)
                        .default(50)
                        .example(50)
                        .description('Relative scale for detecting spam. 0 means that everything is spam, 100 means that nothing is spam'),

                    quota: Joi.number()
                        .min(0)
                        .default(0)
                        .example(1024 * 1024 * 1024)
                        .description('Maximum allowed storage in bytes. Set to 0 to use the default value.'),

                    recipients: Joi.number()
                        .min(0)
                        .default(0)
                        .example(2000)
                        .description('How many messages per 24 hour can be sent. Set to 0 to use the default value.'),

                    forwards: Joi.number()
                        .min(0)
                        .default(0)
                        .example(2000)
                        .description('How many messages per 24 hour can be forwarded. Set to 0 to use the default value.'),

                    requirePasswordChange: booleanSchema
                        .default(false)
                        .example(false)
                        .description('If "true" then sets a flag that requires the user to change their password.'),

                    imapMaxUpload: Joi.number()
                        .min(0)
                        .default(0)
                        .example(5 * 1024 * 1024 * 1024)
                        .description('How many bytes can be uploaded via IMAP during 24 hour'),
                    imapMaxDownload: Joi.number()
                        .min(0)
                        .default(0)
                        .example(20 * 1024 * 1024 * 1024)
                        .description('How many bytes can be downloaded via IMAP during 24 hour'),
                    pop3MaxDownload: Joi.number()
                        .min(0)
                        .default(0)
                        .example(20 * 1024 * 1024 * 1024)
                        .description('How many bytes can be downloaded via POP3 during 24 hour'),
                    pop3MaxMessages: Joi.number().min(0).default(0).example(300).description('How many latest messages to list in POP3 session'),
                    imapMaxConnections: Joi.number().min(0).default(0).example(15).description('How many parallel IMAP connections are alowed'),
                    receivedMax: Joi.number().min(0).default(0).example(60).description('How many messages can be received from MX during 60 seconds'),

                    fromWhitelist: Joi.array()
                        .items(Joi.string().trim().max(128))
                        .example(['user@alternative.domain', '*@example.com'])
                        .description('A list of additional email addresses this user can send mail from. Wildcard is allowed.'),

                    tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with this user'),
                    addTagsToAddress: booleanSchema
                        .default(false)
                        .example(false)
                        .description('If true then autogenerated address gets the same tags as the user'),

                    uploadSentMessages: booleanSchema
                        .default(false)
                        .example(false)
                        .description(
                            'If true then all messages sent through MSA are also uploaded to the Sent Mail folder. Might cause duplicates with some email clients, so disabled by default.'
                        ),

                    mailboxes: Joi.object()
                        .keys({
                            sent: Joi.string()
                                .empty('')
                                .regex(/\/{2,}|\/$/, { invert: true })
                                .example('Saadetud kirjad')
                                .description('Folder name for sent emails'),
                            trash: Joi.string()
                                .empty('')
                                .regex(/\/{2,}|\/$/, { invert: true })
                                .example('Prügikast')
                                .description('Folder name for deleted emails'),
                            junk: Joi.string()
                                .empty('')
                                .regex(/\/{2,}|\/$/, { invert: true })
                                .example('Praht')
                                .description('Folder name for junk emails'),
                            drafts: Joi.string()
                                .empty('')
                                .regex(/\/{2,}|\/$/, { invert: true })
                                .example('Mustandid')
                                .description('Folder name for draft emails')
                        })
                        .label('SetSpecialMailboxNames')
                        .description('Optional names for special mailboxes'),

                    disabledScopes: Joi.array()
                        .items(Joi.string().valid(...consts.SCOPES))
                        .unique()
                        .default([])
                        .example(['imap', 'pop3', 'smtp'])
                        .description('List of scopes that are disabled for this user'),

                    metaData: metaDataSchema
                        .label('metaData')
                        .example({ accountIcon: 'avatar.png' })
                        .description('Optional metadata, must be an object or JSON formatted string'),
                    internalData: metaDataSchema
                        .label('internalData')
                        .example({ inTrial: true })
                        .description(
                            'Optional metadata for internal use, must be an object or JSON formatted string of an object. Not available for user-role tokens'
                        ),

                    pubKey: Joi.string()
                        .allow('')
                        .trim()
                        .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format')
                        .example('-----BEGIN PGP PUBLIC KEY...')
                        .description('Public PGP key for the user that is used for encryption'),
                    encryptMessages: booleanSchema.default(false).example(false).description('Are messages automatically encrypted'),
                    encryptForwarded: booleanSchema.default(false).example(false).description('Are forwarded messages encrypted'),

                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('CreateUserPayload')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: userIdSchema
                }).label('CreateUserReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/users/resolve/{username}',

        async handler(request) {
            // permissions check
            let permission = roles.can(request.app.role).readAny('users');
            request.validateAcl(permission);

            let username = request.params.username;

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
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            return {
                success: true,
                id: userData._id.toString()
            };
        },

        options: {
            description: 'Resolve ID for a username',
            notes: 'Searches for a user account based on the username. Exact matches only.',
            tags: ['api', 'Users'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    username: userUsernameSchema
                        .required()
                        .example('myuser2')
                        .description(
                            'Username of the User. Alphanumeric value. Must start with a letter, dots are allowed but informational only ("user.name" is the same as "username")'
                        )
                }).label('ResolveUserParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('ResolveUserQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: Joi.string().hex().length(24).example('613b069b9a6cbad5ba18d552')
                }).label('ResolveUserReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'GET',
        path: '/users/{user}',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).readOwn('users');
            } else {
                permission = roles.can(request.app.role).readAny('users');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);

            let userData;

            try {
                userData = await db.users.collection('users').findOne({
                    _id: user
                });
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }

            if (!userData) {
                let error = Boom.boomify(new Error('This user does not exist'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
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

            let settings = await settingsHandler.getMulti(['const:max:storage', 'const:max:recipients', 'const:max:forwards']);

            let recipients = Number(userData.recipients) || config.maxRecipients || settings['const:max:recipients'];
            let forwards = Number(userData.forwards) || config.maxForwards || settings['const:max:forwards'];

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

            return permission.filter({
                success: true,
                id: user.toString(),

                username: userData.username,
                name: userData.name,

                address: userData.address,

                language: userData.language,
                location: userData.location,

                retention: userData.retention || false,

                enabled2fa: Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []),
                autoreply: !!userData.autoreply,

                encryptMessages: userData.encryptMessages,
                encryptForwarded: userData.encryptForwarded,
                pubKey: userData.pubKey,
                spamLevel: userData.spamLevel,
                keyInfo,

                metaData: formatMetaData(userData.metaData),
                internalData: formatMetaData(userData.internalData),

                targets: [].concat(userData.targets || []).map(targetData => targetData.value),

                limits: {
                    quota: {
                        allowed: Number(userData.quota) || (config.maxStorage ? config.maxStorage * 1024 * 1024 : settings['const:max:storage']),
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

                    imapUpload: {
                        allowed: Number(userData.imapMaxUpload) || (config.imap.maxUploadMB || 10000) * 1024 * 1024,
                        used: imapUpload,
                        ttl: imapUploadTtl >= 0 ? imapUploadTtl : false
                    },

                    imapDownload: {
                        allowed: Number(userData.imapMaxDownload) || (config.imap.maxDownloadMB || 10000) * 1024 * 1024,
                        used: imapDownload,
                        ttl: imapDownloadTtl >= 0 ? imapDownloadTtl : false
                    },

                    pop3Download: {
                        allowed: Number(userData.pop3MaxDownload) || (config.pop3.maxDownloadMB || 10000) * 1024 * 1024,
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
            });
        },

        options: {
            description: 'Request user information',
            notes: 'Request user information based on the account ID',
            tags: ['api', 'Users'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required()
                }).label('GetUserParams'),

                query: Joi.object({
                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('GetUserQuery')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: userIdSchema,

                    username: userUsernameSchema.description('Username'),
                    name: userNameSchema,

                    address: Joi.string().email().example('john@example.com').description('Default email address of the user'),

                    language: languageSchema,
                    location: locationSchema,

                    retention: Joi.number().allow(false).min(0).default(0).example(false).description('Default retention time (in ms). False if not enabled.'),

                    enabled2fa: Joi.array()
                        .items(Joi.string().valid('totp', 'u2f', 'custom'))
                        .description('A list of enabled two-factor authentication schemes'),
                    autoreply: booleanSchema
                        .example(false)
                        .description('Is autoreply enabled or not (start time may still be in the future or end time in the past)'),

                    encryptMessages: booleanSchema.example(false).description('Are messages automatically encrypted'),
                    encryptForwarded: booleanSchema.example(false).description('Are forwarded messages encrypted'),
                    pubKey: Joi.string()
                        .allow('')
                        .trim()
                        .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format')
                        .example('-----BEGIN PGP PUBLIC KEY...')
                        .description('Public PGP key for the user that is used for encryption'),

                    spamLevel: Joi.number()
                        .min(0)
                        .max(100)
                        .default(50)
                        .example(50)
                        .description('Relative scale for detecting spam. 0 means that everything is spam, 100 means that nothing is spam'),

                    keyInfo: Joi.object({
                        name: Joi.string().example('John Smith').description('Name listed in public key'),
                        address: Joi.string().example('john@example.com').description('E-mail address listed in public key'),
                        fingerprint: Joi.string().example('213fb18b6dca1e2869de47e6954bb3cc1fe60482').description('Fingerprint of the public key')
                    })
                        .label('KeyInfo')
                        .allow(false)
                        .description('Information about public key or false if key is not available'),

                    metaData: Joi.object().unknown(true).example({ accountIcon: 'avatar.png' }).label('UserMetaData').description('Custom metadata value'),

                    internalData: Joi.object()
                        .unknown(true)
                        .example({ accountStatus: 'in_trial' })
                        .label('UserInternalData')
                        .description('Custom metadata value for internal use. Included only if the request was not made using a user-role token'),

                    targets: forwardTargetSchema,

                    limits: Joi.object({
                        quota: Joi.object({
                            allowed: Joi.number()
                                .example(1024 * 1024 * 1024)
                                .description('Allowed storage quota of the user in bytes'),
                            used: Joi.number()
                                .example(512 * 1024)
                                .description('Currently used storage in bytes')
                        })
                            .label('UserStorageQuota')
                            .description('Quota usage limits'),

                        recipients: Joi.object({
                            allowed: Joi.number().example(2000).description('How many messages per 24 hours can be sent'),
                            used: Joi.number().example(381).description('How many messages are sent during current 24 hour period'),
                            ttl: Joi.number()
                                .allow(false)
                                .example(6 * 3600 + 12 * 60 + 7)
                                .description('Time until the end of current 24 hour period')
                        })
                            .label('UserRecipientsQuota')
                            .description('Sending quota'),

                        forwards: Joi.object({
                            allowed: Joi.number().example(2000).description('How many messages per 24 hours can be forwarded'),
                            used: Joi.number().example(381).description('How many messages are forwarded during current 24 hour period'),
                            ttl: Joi.number().allow(false).description('Time until the end of current 24 hour period')
                        })
                            .label('UserForwardsQuota')
                            .description('Forwarding quota'),

                        received: Joi.object({
                            allowed: Joi.number().example(60).description('How many messages per 1 hour can be received'),
                            used: Joi.number().example(56).description('How many messages are received during current 1 hour period'),
                            ttl: Joi.number().allow(false).description('Time until the end of current 1 hour period')
                        })
                            .label('UserReceivedQuota')
                            .description('Receiving quota'),

                        imapUpload: Joi.object({
                            allowed: Joi.number()
                                .example(20 * 1024 * 1024)
                                .description('How many bytes per 24 hours can be uploaded via IMAP. Only message contents are counted, not protocol overhead.'),
                            used: Joi.number()
                                .example(3 * 1024 * 1024)
                                .description('How many bytes are uploaded during current 24 hour period.'),
                            ttl: Joi.number().allow(false).description('Time until the end of current 24 hour period')
                        })
                            .label('UserIMAPUploadQuota')
                            .description('IMAP upload quota'),

                        imapDownload: Joi.object({
                            allowed: Joi.number()
                                .example(20 * 1024 * 1024)
                                .description(
                                    'How many bytes per 24 hours can be downloaded via IMAP. Only message contents are counted, not protocol overhead.'
                                ),
                            used: Joi.number()
                                .example(3 * 1024 * 1024)
                                .description('How many bytes are downloaded during current 24 hour period'),
                            ttl: Joi.number().allow(false).description('Time until the end of current 24 hour period')
                        })
                            .label('UserIMAPDownloadQuota')
                            .description('IMAP download quota'),

                        pop3Download: Joi.object({
                            allowed: Joi.number()
                                .example(20 * 1024 * 1024)
                                .description(
                                    'How many bytes per 24 hours can be downloaded via POP3. Only message contents are counted, not protocol overhead.'
                                ),
                            used: Joi.number()
                                .example(3 * 1024 * 1024)
                                .description('How many bytes are downloaded during current 24 hour period'),
                            ttl: Joi.number().allow(false).description('Time until the end of current 24 hour period')
                        })
                            .label('UserPOP3DownloadQuota')
                            .description('POP3 download quota'),

                        pop3MaxMessages: Joi.object({
                            allowed: Joi.number().example(250).description('Maximum messages allowed to see in POP3')
                        })
                            .label('UserPOP3MessagesQuota')
                            .description('General POP3 limitations'),

                        imapMaxConnections: Joi.object({
                            allowed: Joi.number().example(15).description('How many parallel IMAP connections are permitted'),
                            used: Joi.number().example(5).description('How many parallel IMAP connections are currenlty in use')
                        })
                            .label('UserIMAPConnectionQuota')
                            .description('IMAP connection count limits')
                    })
                        .label('UserQuotaInfo')
                        .description('Account limits and usage'),

                    tags: tagsSchema.example('status:user, account:example.com').description('A list of tags associated with the user'),

                    fromWhitelist: Joi.array()
                        .items(Joi.string().trim().max(128))
                        .example(['user@alternative.domain', '*@example.com'])
                        .description('A list of additional email addresses this user can send mail from. Wildcard is allowed.'),

                    disabledScopes: Joi.array()
                        .items(Joi.string().valid(...consts.SCOPES))
                        .unique()
                        .default([])
                        .example(['imap', 'pop3', 'smtp'])
                        .description('List of scopes that are disabled for this user'),

                    hasPasswordSet: booleanSchema.example(true).description('Does the user have a password set'),
                    activated: booleanSchema.example(true).description('Is the account activated'),
                    disabled: booleanSchema
                        .example(false)
                        .description('Is the account disabled or not. Disabled user can not authenticate or receive any new mail'),
                    suspended: booleanSchema
                        .example(false)
                        .description('Is the account suspended or not. Suspended user can not authenticate, but they can receive mail')
                }).label('GetUserReponse'),
                failAction: 'log'
            }
        }
    });

    server.route({
        method: 'PUT',
        path: '/users/{user}',

        async handler(request) {
            // permissions check
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).updateOwn('users');
            } else {
                permission = roles.can(request.app.role).updateAny('users');
            }
            request.validateAcl(permission);

            // filter out unallowed fields
            let values = permission.filter(request.payload);

            let user = new ObjectId(request.params.user);

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
                    let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                    error.output.payload.code = 'InternalDatabaseError';
                    throw error;
                }
            }

            if (values.tags) {
                values.tagsview = values.tags.map(tag => tag.toLowerCase());
            }

            if (values.fromWhitelist && values.fromWhitelist.length) {
                values.fromWhitelist = Array.from(new Set(values.fromWhitelist.map(address => normalizeAddress(address))));
            }

            try {
                await getKeyInfo(values.pubKey);
            } catch (err) {
                let error = Boom.boomify(new Error('PGP key validation failed. ' + err.message), { statusCode: 400 });
                error.output.payload.code = 'InputValidationError';
                throw error;
            }

            let updateResponse;
            try {
                updateResponse = await userHandler.update(user, values);
            } catch (err) {
                log.error('API', err);
                let error = Boom.boomify(err, { statusCode: err.responseCode || 500 });
                error.output.payload.code = err.code;
                error.output.payload.username = values.username;
                throw error;
            }

            let { success, passwordChanged } = updateResponse || {};
            if (passwordChanged && request.app.accessToken && typeof request.app.accessToken.update === 'function') {
                try {
                    // update access token data for current session after password change
                    await request.app.accessToken.update();
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

            return {
                success,
                id: user.toString()
            };
        },

        options: {
            description: 'Update User information',
            notes: 'Update user account information',
            tags: ['api', 'Users'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required()
                }).label('UpdateUserParams'),

                payload: Joi.object({
                    //if set then this password is validated before data is updated
                    existingPassword: Joi.string().empty('').min(1).max(256).description('Existing password to validate request'),

                    name: userNameSchema.allow(''),

                    password: Joi.string()
                        .max(1024)
                        .allow(false, '')
                        .example('secretvalue')
                        .description(
                            'Password for the user. Set to boolean "false" to disable password usage for the master scope. Application Specific Passwords would still be allowed.'
                        ),

                    hashedPassword: booleanSchema
                        .default(false)
                        .example(false)
                        .description(
                            'If "true" then password is already hashed, so store it as it is. Supported hashes: "pbkdf2", "bcrypt" ($2a, $2y, $2b), "md5" ($1), "sha512" ($6), sha256 ($5), "argon2" ($argon2d, $argon2i, $argon2id). Stored hashes are rehashed to "pbkdf2" on first successful password check.'
                        ),

                    language: languageSchema.empty(''),
                    location: locationSchema.empty(''),

                    retention: Joi.number()
                        .allow(false)
                        .min(0)
                        .default(0)
                        .example(0)
                        .description('Default retention time (in ms). Set to 0 or false to disable.'),

                    targets: forwardTargetSchema,

                    spamLevel: Joi.number()
                        .min(0)
                        .max(100)
                        .default(50)
                        .example(50)
                        .description('Relative scale for detecting spam. 0 means that everything is spam, 100 means that nothing is spam'),

                    quota: Joi.number()
                        .min(0)
                        .default(0)
                        .example(1024 * 1024 * 1024)
                        .description('Maximum allowed storage in bytes. Set to 0 to use the default value.'),

                    recipients: Joi.number()
                        .min(0)
                        .default(0)
                        .example(2000)
                        .description('How many messages per 24 hour can be sent. Set to 0 to use the default value.'),

                    forwards: Joi.number()
                        .min(0)
                        .default(0)
                        .example(2000)
                        .description('How many messages per 24 hour can be forwarded. Set to 0 to use the default value.'),

                    imapMaxUpload: Joi.number()
                        .min(0)
                        .default(0)
                        .example(5 * 1024 * 1024 * 1024)
                        .description('How many bytes can be uploaded via IMAP during 24 hour'),
                    imapMaxDownload: Joi.number()
                        .min(0)
                        .default(0)
                        .example(20 * 1024 * 1024 * 1024)
                        .description('How many bytes can be downloaded via IMAP during 24 hour'),
                    pop3MaxDownload: Joi.number()
                        .min(0)
                        .default(0)
                        .example(20 * 1024 * 1024 * 1024)
                        .description('How many bytes can be downloaded via POP3 during 24 hour'),
                    pop3MaxMessages: Joi.number().min(0).default(0).example(300).description('How many latest messages to list in POP3 session'),
                    imapMaxConnections: Joi.number().min(0).default(0).example(15).description('How many parallel IMAP connections are alowed'),
                    receivedMax: Joi.number().min(0).default(0).example(60).description('How many messages can be received from MX during 60 seconds'),

                    fromWhitelist: Joi.array()
                        .items(Joi.string().trim().max(128))
                        .example(['user@alternative.domain', '*@example.com'])
                        .description('A list of additional email addresses this user can send mail from. Wildcard is allowed.'),

                    tags: tagsArraySchema.example(['status:user', 'account:example.com']).description('A list of tags associated with this user'),

                    uploadSentMessages: booleanSchema
                        .default(false)
                        .example(false)
                        .description(
                            'If true then all messages sent through MSA are also uploaded to the Sent Mail folder. Might cause duplicates with some email clients, so disabled by default.'
                        ),

                    disabledScopes: Joi.array()
                        .items(Joi.string().valid(...consts.SCOPES))
                        .unique()
                        .default([])
                        .example(['imap', 'pop3', 'smtp'])
                        .description('List of scopes that are disabled for this user'),

                    metaData: metaDataSchema
                        .label('metaData')
                        .example({ accountIcon: 'avatar.png' })
                        .description('Optional metadata, must be an object or JSON formatted string'),
                    internalData: metaDataSchema
                        .label('internalData')
                        .example({ inTrial: true })
                        .description(
                            'Optional metadata for internal use, must be an object or JSON formatted string of an object. Not available for user-role tokens'
                        ),

                    pubKey: Joi.string()
                        .allow('')
                        .trim()
                        .regex(/^-----BEGIN PGP PUBLIC KEY BLOCK-----/, 'PGP key format')
                        .example('-----BEGIN PGP PUBLIC KEY...')
                        .description('Public PGP key for the user that is used for encryption'),
                    encryptMessages: booleanSchema.default(false).example(false).description('Are messages automatically encrypted'),
                    encryptForwarded: booleanSchema.default(false).example(false).description('Are forwarded messages encrypted'),

                    disable2fa: booleanSchema.example(false).description('If true, then disables 2FA for this user'),

                    disabled: booleanSchema
                        .example(false)
                        .description('Is the account disabled or not. Disabled user can not authenticate or receive any new mail'),

                    suspended: booleanSchema
                        .example(false)
                        .description('Is the account suspended or not. Suspended user can not authenticate, but they can receive mail'),

                    sess: sessSchema,
                    ip: sessIPSchema
                }).label('UpdateUserPayload')
            },

            response: {
                schema: Joi.object({
                    success: Joi.boolean().example(true).required().description('Was the query successful or not'),
                    id: userIdSchema
                }).label('UpdateUserReponse'),
                failAction: 'log'
            }
        }
    });

    /*

    server.put(
        '/users/:user/logout',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
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
                res.status(500); // TODO: use response code specific status
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

    server.post(
        '/users/:user/quota/reset',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
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
                        returnDocument: 'before',
                        projection: {
                            storageUsed: true
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

            if (!updateResponse || !updateResponse.value) {
                res.status(404);
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

    server.post(
        '/quota/reset',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).updateAny('users'));

            let task;
            try {
                task = await taskHandler.add('quota', {});
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
            return next();
        })
    );

    server.post(
        '/users/:user/password/reset',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).updateAny('users'));

            let user = new ObjectId(result.value.user);

            let password;
            try {
                password = await userHandler.reset(user, result.value);
            } catch (err) {
                res.status(500); // TODO: use response code specific status
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

    server.del(
        '/users/:user',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).deleteAny('users'));

            let user = new ObjectId(result.value.user);

            let deleteResponse;
            try {
                deleteResponse = await userHandler.delete(user, Object.assign({}, result.value));
            } catch (err) {
                res.status(500); // TODO: use response code specific status
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json(
                Object.assign(
                    {
                        success: !!deleteResponse,
                        code: 'TaskScheduled'
                    },
                    deleteResponse || {}
                )
            );
            return next();
        })
    );

    server.get(
        '/users/:user/restore',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
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
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json(
                Object.assign(
                    {
                        success: !!userInfo
                    },
                    userInfo
                )
            );

            return next();
        })
    );

    server.post(
        '/users/:user/restore',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
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
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json(
                Object.assign(
                    {
                        success: !!task,
                        code: task && task.task ? 'TaskCancelled' : 'RequestProcessed'
                    },
                    task || {}
                )
            );

            return next();
        })
    );
*/
};
