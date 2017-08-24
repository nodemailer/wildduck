'use strict';

const config = require('wild-config');
const log = require('npmlog');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const tools = require('./tools');
const consts = require('./consts');
const counters = require('./counters');
const ObjectID = require('mongodb').ObjectID;
const generatePassword = require('generate-password');
const os = require('os');
const crypto = require('crypto');
const mailboxTranslations = require('./translations');
const base32 = require('base32.js');
const MailComposer = require('nodemailer/lib/mail-composer');
const humanname = require('humanname');

class UserHandler {
    constructor(options) {
        this.database = options.database;
        this.users = options.users || options.database;
        this.redis = options.redis;
        this.messageHandler = options.messageHandler;
        this.counters = this.messageHandler ? this.messageHandler.counters : counters(this.redis);
        this.authlogExpireDays = options.authlogExpireDays;
    }

    /**
     * Authenticate user
     *
     * @param {String} username Either username or email address
     */
    authenticate(username, password, requiredScope, meta, callback) {
        if (!callback && typeof meta === 'function') {
            callback = meta;
            meta = {};
        }

        meta = meta || {};
        meta.requiredScope = requiredScope;

        if (!password) {
            // do not allow signing in without a password
            return callback(null, false);
        }

        let checkAddress = next => {
            if (username.indexOf('@') < 0) {
                // assume regular username
                return next(null, {
                    unameview: username.replace(/\./g, '')
                });
            }

            // try to find existing email address
            let address = tools.normalizeAddress(username);
            this.users.collection('addresses').findOne({
                addrview: address.substr(0, address.indexOf('@')).replace(/\./g, '') + address.substr(address.indexOf('@'))
            }, {
                fields: {
                    user: true
                }
            }, (err, addressData) => {
                if (err) {
                    return callback(err);
                }

                if (!addressData) {
                    meta.address = address;
                    meta.result = 'unknown';
                    return this.logAuthEvent(null, meta, () => callback(null, false));
                }

                next(null, {
                    _id: addressData.user
                });
            });
        };

        checkAddress((err, query) => {
            if (err) {
                return callback(err);
            }

            this.users.collection('users').findOne(query, {
                fields: {
                    _id: true,
                    username: true,
                    password: true,
                    enabled2fa: true,
                    requirePasswordChange: true,
                    disabled: true
                }
            }, (err, userData) => {
                if (err) {
                    return callback(err);
                }

                if (!userData) {
                    if (query.unameview) {
                        meta.username = query.unameview;
                    } else {
                        meta.user = query._id;
                    }
                    meta.result = 'unknown';
                    return this.logAuthEvent(null, meta, () => callback(null, false));
                }

                if (userData.disabled) {
                    // disabled users can not log in
                    meta.result = 'disabled';

                    meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.ip].join(':');
                    return this.logAuthEvent(userData._id, meta, () => callback(null, false));
                }

                let rlkey = 'auth:' + userData._id.toString();
                this.counters.ttlcounter(rlkey, 0, consts.AUTH_FAILURES, consts.AUTH_WINDOW, (err, res) => {
                    if (err) {
                        return callback(err);
                    }
                    if (!res.success) {
                        let err = new Error('Authentication was rate limited. Check again in ' + res.ttl + ' seconds');
                        err.response = 'NO';
                        return callback(err);
                    }

                    let authSuccess = (...args) => {
                        // clear rate limit counter on success
                        this.redis.del(rlkey, () => false);
                        callback(...args);
                    };

                    let authFail = (...args) => {
                        // increment rate limit counter on failure
                        this.counters.ttlcounter(rlkey, 1, consts.AUTH_FAILURES, consts.AUTH_WINDOW, () => {
                            callback(...args);
                        });
                    };

                    // try master password
                    bcrypt.compare(password, userData.password || '', (err, success) => {
                        if (err) {
                            return callback(err);
                        }
                        if (success) {
                            meta.result = 'success';
                            meta.source = 'master';
                            if (userData.enabled2fa) {
                                meta.require2fa = true;
                            }
                            meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.source, meta.ip].join(':');
                            return this.logAuthEvent(userData._id, meta, () =>
                                authSuccess(null, {
                                    user: userData._id,
                                    username: userData.username,
                                    scope: 'master',
                                    // if 2FA is enabled then require token validation
                                    require2fa: !!userData.enabled2fa
                                })
                            );
                        }

                        if (requiredScope === 'master') {
                            // only master password can be used for management tasks
                            meta.result = 'fail';
                            meta.source = 'master';
                            meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.source, meta.ip].join(':');
                            return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                        }

                        // try application specific passwords
                        password = password.replace(/\s+/g, '').toLowerCase();

                        if (!/^[a-z]{16}$/.test(password)) {
                            // does not look like an application specific password
                            meta.result = 'fail';
                            meta.source = 'master';
                            meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.source, meta.ip].join(':');
                            return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                        }

                        let prefix = crypto.createHash('md5').update(password.substr(0, 4)).digest('hex');

                        this.users
                            .collection('asps')
                            .find({
                                user: userData._id
                            })
                            .toArray((err, asps) => {
                                if (err) {
                                    return callback(err);
                                }

                                if (!asps || !asps.length) {
                                    // user does not have app specific passwords set
                                    meta.result = 'fail';
                                    meta.source = 'master';
                                    meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.source, meta.ip].join(':');
                                    return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                                }

                                let pos = 0;
                                let checkNext = () => {
                                    if (pos >= asps.length) {
                                        meta.result = 'fail';
                                        meta.source = 'master';
                                        meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.source, meta.ip].join(':');
                                        return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                                    }

                                    let asp = asps[pos++];
                                    if (asp.prefix && asp.prefix !== prefix) {
                                        // no need to check, definitely a wrong one
                                        return setImmediate(checkNext);
                                    }

                                    bcrypt.compare(password, asp.password || '', (err, success) => {
                                        if (err) {
                                            return callback(err);
                                        }

                                        if (!success) {
                                            return setImmediate(checkNext);
                                        }

                                        if (!asp.scopes.includes('*') && !asp.scopes.includes(requiredScope)) {
                                            meta.result = 'fail';
                                            meta.source = 'asp';
                                            meta.asp = asp._id.toString();
                                            meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.asp, 'scope', meta.ip].join(':');
                                            return this.logAuthEvent(userData._id, meta, () => authFail(new Error('Authentication failed. Invalid scope')));
                                        }

                                        meta.result = 'success';
                                        meta.source = 'asp';
                                        meta.asp = asp._id.toString();
                                        meta.groupKey = ['authenticate', meta.protocol, meta.result, meta.asp, meta.ip].join(':');
                                        return this.logAuthEvent(userData._id, meta, () => {
                                            this.redis.del(rlkey, () => false);
                                            authSuccess(null, {
                                                user: userData._id,
                                                username: userData.username,
                                                scope: requiredScope,
                                                asp: asp._id.toString(),
                                                require2fa: false, // application scope never requires 2FA
                                                requirePasswordChange: !!userData.requirePasswordChange // true, if password was reset
                                            });
                                        });
                                    });
                                };

                                checkNext();
                            });
                    });
                });
            });
        });
    }

    generateASP(user, data, callback) {
        let password = generatePassword.generate({
            length: 16,
            uppercase: false,
            numbers: false,
            symbols: false
        });
        // We need a quick hash key that can be used to identify the password.
        // Otherwise, when authenticating, we'd need to check the password against all stored bcrypt
        // hashes which would make forever if the user has a longer list of application specific passwords
        let prefix = crypto.createHash('md5').update(password.substr(0, 4)).digest('hex');

        let allowedScopes = ['imap', 'pop3', 'smtp'];
        let hasAllScopes = false;
        let scopeSet = new Set();
        let scopes = [].concat(data.scopes || []);

        scopes.forEach(scope => {
            scope = scope.toLowerCase().trim();
            if (scope === '*') {
                hasAllScopes = true;
            } else {
                scopeSet.add(scope);
            }
        });
        if (hasAllScopes || scopeSet.size === allowedScopes.length) {
            scopes = ['*'];
        } else {
            scopes = Array.from(scopeSet).sort();
        }

        let passwordData = {
            id: new ObjectID(),
            user,
            description: data.description,
            scopes,
            password: bcrypt.hashSync(password, consts.BCRYPT_ROUNDS),
            prefix,
            created: new Date()
        };

        // register this address as the default address for that user
        return this.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                _id: true
            }
        }, (err, userData) => {
            if (err) {
                log.error('DB', 'DBFAIL generateASP id=%s error=%s', user, err.message);
                return callback(new Error('Database Error, failed to find user'));
            }
            if (!userData) {
                return callback(new Error('User not found'));
            }

            this.users.collection('asps').insertOne(passwordData, err => {
                if (err) {
                    return callback(err);
                }
                return this.logAuthEvent(
                    user,
                    {
                        action: 'create asp',
                        asp: passwordData._id,
                        result: 'success',
                        ip: data.ip
                    },
                    () =>
                        callback(null, {
                            id: passwordData._id,
                            password
                        })
                );
            });
        });
    }

    deleteASP(user, asp, data, callback) {
        this.users.collection('asps').deleteOne({
            _id: asp,
            user
        }, (err, r) => {
            if (err) {
                return callback(err);
            }

            if (!r.deletedCount) {
                return callback(new Error('Application Specific Password was not found'));
            }

            return this.logAuthEvent(
                user,
                {
                    action: 'delete asp',
                    asp,
                    result: 'success',
                    ip: data.ip
                },
                () => callback(null, true)
            );
        });
    }

    create(data, callback) {
        this.users.collection('users').findOne({
            username: data.username.replace(/\./g, '')
        }, {
            fields: {
                unameview: true
            }
        }, (err, userData) => {
            if (err) {
                log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                return callback(new Error('Database Error, failed to create user'));
            }

            if (userData) {
                let err = new Error('This username already exists');
                return callback(err);
            }

            let junkRetention = consts.JUNK_RETENTION;

            // Insert user data

            // Users with an empty password can not log in
            let hash = data.password ? bcrypt.hashSync(data.password, consts.BCRYPT_ROUNDS) : '';
            let id = new ObjectID();
            this.users.collection('users').insertOne({
                _id: id,

                username: data.username,
                // dotless version
                unameview: data.username.replace(/\./g, ''),

                name: data.name,

                // security
                password: '', // set this later. having no password prevents login
                asp: [], // list of application specific passwords

                enabled2fa: false,
                seed: '', // 2fa seed value

                // default email address
                address: '', // set this later

                // quota
                storageUsed: 0,
                quota: data.quota || 0,
                recipients: data.recipients || 0,
                forwards: data.forwards || 0,

                // autoreply status
                // off by default, can be changed later by user through the API
                autoreply: false,

                pubKey: data.pubKey || '',
                encryptMessages: !!data.encryptMessages,

                // default retention for user mailboxes
                retention: data.retention || 0,

                created: new Date(),

                requirePasswordChange: false,

                // until setup value is not true, this account is not usable
                activated: false,
                disabled: true
            }, err => {
                if (err) {
                    log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                    return callback(new Error('Database Error, failed to create user'));
                }

                let mailboxes = this.getMailboxes(data.language).map(mailbox => {
                    mailbox.user = id;

                    if (['\\Trash', '\\Junk'].includes(mailbox.specialUse)) {
                        mailbox.retention = data.retention ? Math.min(data.retention, junkRetention) : junkRetention;
                    } else {
                        mailbox.retention = data.retention;
                    }

                    return mailbox;
                });

                this.database.collection('mailboxes').insertMany(mailboxes, {
                    w: 1,
                    ordered: false
                }, err => {
                    if (err) {
                        // try to rollback
                        this.users.collection('users').deleteOne({ _id: id }, () => false);

                        log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                        return callback(new Error('Database Error, failed to create user'));
                    }

                    let address = data.address ? data.address : data.username + '@' + (config.emailDomain || os.hostname()).toLowerCase();

                    // insert alias address to email address registry
                    this.users.collection('addresses').insertOne({
                        user: id,
                        address,
                        // dotless version
                        addrview: address.substr(0, address.indexOf('@')).replace(/\./g, '') + address.substr(address.indexOf('@')),
                        created: new Date()
                    }, err => {
                        if (err) {
                            // try to rollback
                            this.users.collection('users').deleteOne({ _id: id }, () => false);
                            this.database.collection('mailboxes').deleteMany({ user: id }, () => false);

                            log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);

                            let response;
                            switch (err.code) {
                                case 11000:
                                    response = 'Selected email address already exists';
                                    break;
                                default:
                                    response = 'Database Error, failed to create user';
                            }

                            return callback(new Error(response));
                        }

                        // register this address as the default address for that user
                        return this.users.collection('users').findOneAndUpdate({
                            _id: id,
                            activated: false
                        }, {
                            $set: {
                                password: hash,
                                address,
                                activated: true,
                                disabled: false
                            }
                        }, { returnOriginal: false }, (err, result) => {
                            if (err) {
                                // try to rollback
                                this.users.collection('users').deleteOne({ _id: id }, () => false);
                                this.database.collection('mailboxes').deleteMany({ user: id }, () => false);

                                log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                                return callback(new Error('Database Error, failed to create user'));
                            }

                            let userData = result.value;

                            if (!userData) {
                                // should never happen
                                return callback(null, id);
                            }

                            let createSuccess = () =>
                                this.logAuthEvent(
                                    id,
                                    {
                                        action: 'account created',
                                        result: 'success',
                                        ip: data.ip
                                    },
                                    () => callback(null, id)
                                );

                            if (!this.messageHandler) {
                                return createSuccess();
                            }

                            let parsedName = humanname.parse(userData.name || '');
                            this.pushDefaultMessages(
                                userData,
                                {
                                    NAME: userData.name || address,
                                    FNAME: parsedName.firstName,
                                    LNAME: parsedName.lastName,
                                    DOMAIN: address.substr(address.indexOf('@') + 1),
                                    EMAIL: address
                                },
                                () => createSuccess()
                            );
                        });
                    });
                });
            });
        });
    }

    pushDefaultMessages(userData, tags, callback) {
        tools.getEmailTemplates(tags, (err, messages) => {
            if (err || !messages || !messages.length) {
                return callback();
            }

            let pos = 0;
            let insertMessages = () => {
                if (pos >= messages.length) {
                    return callback();
                }
                let data = messages[pos++];
                let compiler = new MailComposer(data);

                compiler.compile().build((err, message) => {
                    if (err) {
                        return insertMessages();
                    }

                    let mailboxQueryKey = 'path';
                    let mailboxQueryValue = 'INBOX';

                    if (['sent', 'trash', 'junk', 'drafts', 'archive'].includes((data.mailbox || '').toString().toLowerCase())) {
                        mailboxQueryKey = 'specialUse';
                        mailboxQueryValue = '\\' + data.mailbox.toLowerCase().replace(/^./g, c => c.toUpperCase());
                    }

                    let flags = [];
                    if (data.seen) {
                        flags.push('\\Seen');
                    }
                    if (data.flag) {
                        flags.push('\\Flagged');
                    }

                    this.messageHandler.encryptMessage(userData.encryptMessages ? userData.pubKey : false, message, (err, encrypted) => {
                        if (!err && encrypted) {
                            message = encrypted;
                        }

                        this.messageHandler.add(
                            {
                                user: userData._id,
                                [mailboxQueryKey]: mailboxQueryValue,
                                meta: {
                                    source: 'AUTO',
                                    time: Date.now()
                                },
                                flags,
                                raw: message
                            },
                            insertMessages
                        );
                    });
                });
            };
            insertMessages();
        });
    }

    reset(user, callback) {
        let password = generatePassword.generate({
            length: 12,
            uppercase: true,
            numbers: true,
            symbols: false
        });

        return this.users.collection('users').findOneAndUpdate({
            _id: user
        }, {
            $set: {
                enabled2fa: false,
                seed: '',
                requirePasswordChange: true,
                password: bcrypt.hashSync(password, consts.BCRYPT_ROUNDS)
            }
        }, {}, (err, result) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                return callback(new Error('Database Error, failed to reset user credentials'));
            }

            if (!result || !result.value) {
                return callback(new Error('Could not update user ' + user));
            }

            return callback(null, password);
        });
    }

    setup2fa(user, data, callback) {
        return this.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                username: true,
                enabled2fa: true,
                seed: true
            }
        }, (err, userData) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                return callback(new Error('Database Error, failed to check user'));
            }

            if (!userData) {
                return callback(new Error('Could not find user data'));
            }

            if (userData.enabled2fa) {
                return callback(new Error('2FA is already enabled for this user'));
            }

            if (!data.fresh && userData.seed) {
                if (userData.seed) {
                    let secret = userData.seed;
                    if (userData.seed.charAt(0) === '$' && config.totp && config.totp.secret) {
                        let decipher = crypto.createDecipher(config.totp.cipher || 'aes192', config.totp.secret);
                        secret = decipher.update(userData.seed.substr(1), 'hex', 'utf-8');
                        secret += decipher.final('utf8');
                    }

                    let otpauth_url = speakeasy.otpauthURL({
                        secret: base32.decode(secret),
                        label: userData.username,
                        issuer: data.issuer || 'Wild Duck'
                    });

                    return QRCode.toDataURL(otpauth_url, (err, data_url) => {
                        if (err) {
                            log.error('DB', 'QRFAIL username=%s error=%s', userData.username, err.message);
                            return callback(new Error('Failed to generate QR code'));
                        }
                        return callback(null, data_url);
                    });
                }
            }

            let secret = speakeasy.generateSecret({
                length: 20,
                name: userData.username
            });

            let seed = secret.base32;
            if (config.totp && config.totp.secret) {
                let cipher = crypto.createCipher(config.totp.cipher || 'aes192', config.totp.secret);
                seed = '$' + cipher.update(seed, 'utf8', 'hex');
                seed += cipher.final('hex');
            }

            return this.users.collection('users').findOneAndUpdate({
                _id: user,
                enabled2fa: false
            }, {
                $set: {
                    seed
                }
            }, {}, (err, result) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    return callback(new Error('Database Error, failed to update user'));
                }

                if (!result || !result.value) {
                    return callback(new Error('Could not update user, check if 2FA is not already enabled'));
                }

                let otpauth_url = speakeasy.otpauthURL({
                    secret: secret.ascii,
                    label: userData.username,
                    issuer: data.issuer || 'Wild Duck'
                });

                QRCode.toDataURL(otpauth_url, (err, data_url) => {
                    if (err) {
                        log.error('DB', 'QRFAIL id=%s error=%s', user, err.message);
                        return callback(new Error('Failed to generate QR code'));
                    }
                    return this.logAuthEvent(
                        user,
                        {
                            action: 'new 2fa seed',
                            ip: data.ip
                        },
                        () => callback(null, data_url)
                    );
                });
            });
        });
    }

    enable2fa(user, data, callback) {
        this.users.collection('users').findOne({
            _id: user
        }, {
            fields: {
                enabled2fa: true,
                username: true,
                seed: true
            }
        }, (err, userData) => {
            if (err) {
                log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                return callback(new Error('Database Error, failed to update user'));
            }
            if (!userData) {
                let err = new Error('This username does not exist');
                return callback(err);
            }

            if (!userData.seed) {
                // 2fa not set up
                let err = new Error('2FA is not initialized for this user');
                return callback(err);
            }

            if (userData.enabled2fa) {
                // 2fa not set up
                let err = new Error('2FA is already enabled for this user');
                return callback(err);
            }

            let secret = userData.seed;
            if (userData.seed.charAt(0) === '$' && config.totp && config.totp.secret) {
                let decipher = crypto.createDecipher(config.totp.cipher || 'aes192', config.totp.secret);
                secret = decipher.update(userData.seed.substr(1), 'hex', 'utf-8');
                secret += decipher.final('utf8');
            }

            let verified = speakeasy.totp.verify({
                secret,
                encoding: 'base32',
                token: data.token,
                window: 6
            });

            if (!verified) {
                return this.logAuthEvent(
                    user,
                    {
                        action: 'enable 2fa',
                        result: 'fail',
                        ip: data.ip
                    },
                    () => callback(null, false)
                );
            }

            // token was valid, update user settings
            return this.users.collection('users').findOneAndUpdate({
                _id: user,
                seed: userData.seed
            }, {
                $set: {
                    enabled2fa: true
                }
            }, {}, (err, result) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    return callback(new Error('Database Error, failed to update user'));
                }

                if (!result || !result.value) {
                    return callback(new Error('Failed to set up 2FA. Check if it is not already enabled'));
                }

                return this.logAuthEvent(
                    user,
                    {
                        action: 'enable 2fa',
                        result: 'success',
                        ip: data.ip
                    },
                    () => callback(null, true)
                );
            });
        });
    }

    disable2fa(user, data, callback) {
        return this.users.collection('users').findOneAndUpdate({
            _id: user,
            enabled2fa: true
        }, {
            $set: {
                enabled2fa: false,
                seed: ''
            }
        }, {}, (err, result) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                return callback(new Error('Database Error, failed to update user'));
            }

            if (!result || !result.value) {
                return callback(new Error('Could not update user, check if 2FA is not already disabled'));
            }

            return this.logAuthEvent(
                user,
                {
                    action: 'disable 2fa',
                    ip: data.ip
                },
                () => callback(null, true)
            );
        });
    }

    check2fa(user, data, callback) {
        let rlkey = 'totp:' + user.toString();
        this.counters.ttlcounter(rlkey, 0, consts.AUTH_FAILURES, consts.AUTH_WINDOW * 3, (err, res) => {
            if (err) {
                return callback(err);
            }
            if (!res.success) {
                let err = new Error('Authentication was rate limited. Check again in ' + res.ttl + ' seconds');
                err.response = 'NO';
                return callback(err);
            }

            let authSuccess = (...args) => {
                // clear rate limit counter on success
                this.redis.del(rlkey, () => false);
                callback(...args);
            };

            let authFail = (...args) => {
                // increment rate limit counter on failure
                this.counters.ttlcounter(rlkey, 1, consts.TOTP_FAILURES, consts.TOTP_WINDOW, () => {
                    callback(...args);
                });
            };

            this.users.collection('users').findOne({
                _id: user
            }, {
                fields: {
                    username: true,
                    enabled2fa: true,
                    seed: true
                }
            }, (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    return callback(new Error('Database Error, failed to find user'));
                }
                if (!userData) {
                    let err = new Error('This user does not exist');
                    return callback(err);
                }

                if (!userData.seed || !userData.enabled2fa) {
                    // 2fa not set up
                    let err = new Error('2FA is not enabled for this user');
                    return callback(err);
                }

                let secret = userData.seed;
                if (userData.seed.charAt(0) === '$' && config.totp && config.totp.secret) {
                    let decipher = crypto.createDecipher(config.totp.cipher || 'aes192', config.totp.secret);
                    secret = decipher.update(userData.seed.substr(1), 'hex', 'utf-8');
                    secret += decipher.final('utf8');
                }

                let verified = speakeasy.totp.verify({
                    secret,
                    encoding: 'base32',
                    token: data.token,
                    window: 6
                });

                return this.logAuthEvent(
                    user,
                    {
                        action: '2fa',
                        ip: data.ip,
                        result: verified ? 'success' : 'fail'
                    },
                    () => {
                        if (verified) {
                            authSuccess(null, verified);
                        } else {
                            authFail(null, verified);
                        }
                    }
                );
            });
        });
    }

    update(user, data, callback) {
        let $set = {};
        let updates = false;
        let passwordChanged = false;

        Object.keys(data).forEach(key => {
            if (['user', 'existingPassword', 'ip'].includes(key)) {
                return;
            }
            if (key === 'password') {
                $set.password = bcrypt.hashSync(data[key], consts.BCRYPT_ROUNDS);
                $set.requirePasswordChange = false;
                $set.passwordChange = new Date();
                passwordChanged = true;
                return;
            }
            $set[key] = data[key];
            updates = true;
        });

        if ($set.username) {
            $set.unameview = $set.username.replace(/\./g, '');
        }

        if (!updates) {
            return callback(new Error('Nothing was updated'));
        }

        let verifyExistingPassword = next => {
            if (!data.existingPassword) {
                return next();
            }
            this.users.collection('users').findOne({ _id: user }, { fields: { password: true } }, (err, userData) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    return callback(new Error('Database Error, failed to find user'));
                }

                if (!userData) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, 'User was not found');
                    return callback(new Error('User was not found'));
                }

                if (bcrypt.compareSync(data.existingPassword, userData.password || '')) {
                    return next();
                } else {
                    return this.logAuthEvent(
                        user,
                        {
                            action: 'password change',
                            result: 'fail',
                            ip: data.ip
                        },
                        () => callback(new Error('Password verification failed'))
                    );
                }
            });
        };

        verifyExistingPassword(() => {
            this.users.collection('users').findOneAndUpdate({
                _id: user
            }, {
                $set
            }, {
                returnOriginal: false
            }, (err, result) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    return callback(new Error('Database Error, failed to update user'));
                }

                if (!result || !result.value) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, 'User was not found');
                    return callback(new Error('user was not found'));
                }

                if (passwordChanged) {
                    return this.logAuthEvent(
                        user,
                        {
                            action: 'password change',
                            result: 'success',
                            ip: data.ip
                        },
                        () => callback(null, true)
                    );
                } else {
                    return callback(null, true);
                }
            });
        });
    }

    getMailboxes(language) {
        let translation = mailboxTranslations.hasOwnProperty(language) ? mailboxTranslations[language] : mailboxTranslations.en;

        let defaultMailboxes = [
            {
                path: 'INBOX'
            },
            {
                specialUse: '\\Sent'
            },
            {
                specialUse: '\\Trash'
            },
            {
                specialUse: '\\Drafts'
            },
            {
                specialUse: '\\Junk'
            },
            {
                specialUse: '\\Archive'
            }
        ];

        let uidValidity = Math.floor(Date.now() / 1000);

        return defaultMailboxes.map(mailbox => ({
            path: translation[mailbox.specialUse || mailbox.path] || mailbox.path,
            specialUse: mailbox.specialUse,
            uidValidity,
            uidNext: 1,
            modifyIndex: 0,
            subscribed: true,
            flags: []
        }));
    }

    logAuthEvent(user, entry, callback) {
        if (user) {
            entry.user = user;
        }

        entry.action = entry.action || 'authentication';
        entry.created = new Date();
        entry.expires = new Date(Date.now() + this.authlogExpireDays * 24 * 3600 * 1000);

        if (!entry.groupKey) {
            return this.users.collection('authlog').insertOne(entry, callback);
        }

        entry.count = 1;
        entry.groupKey = crypto.createHash('sha1').update(entry.groupKey + ':' + Math.floor(Date.now() / (3600 * 1000))).digest('base64');
        entry.updated = entry.created;
        this.users.collection('authlog').findOneAndUpdate({
            user,
            groupKey: entry.groupKey
        }, {
            $inc: { count: 1 },
            $set: {
                updated: entry.updated
            }
        }, (err, r) => {
            if (err) {
                return callback(err);
            }
            if (r && r.value) {
                // an existing entry was updated
                return callback(null, true);
            }
            // add new entry
            this.users.collection('authlog').insertOne(entry, callback);
        });
    }
}

module.exports = UserHandler;
