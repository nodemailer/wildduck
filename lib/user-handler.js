'use strict';

const config = require('wild-config');
const log = require('npmlog');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const tools = require('./tools');
const consts = require('./consts');
const ObjectID = require('mongodb').ObjectID;
const generatePassword = require('generate-password');
const base32 = require('base32.js');
const os = require('os');

const mailboxTranslations = {
    en: {
        '\\Sent': 'Sent Mail',
        '\\Trash': 'Trash',
        '\\Junk': 'Junk',
        '\\Drafts': 'Drafts',
        '\\Archive': 'Archive'
    },
    et: {
        '\\Sent': 'Saadetud kirjad',
        '\\Trash': 'Prügikast',
        '\\Junk': 'Rämpspost',
        '\\Drafts': 'Mustandid',
        '\\Archive': 'Arhiiv'
    }
};

class UserHandler {
    constructor(options) {
        this.database = options.database;
        this.users = options.users || options.database;
        this.redis = options.redis;
    }

    /**
     * Authenticate user
     *
     * @param {String} username Either username or email address
     */
    authenticate(username, password, meta, callback) {
        if (!callback && typeof meta === 'function') {
            callback = meta;
            meta = {};
        }

        if (!password) {
            // do not allow signing in without a password
            return callback(null, false);
        }

        let checkAddress = next => {
            if (username.indexOf('@') < 0) {
                // assume regular username
                return next(null, {
                    username
                });
            }

            // try to find existing email address
            let address = tools.normalizeAddress(username);
            this.users.collection('addresses').findOne({
                address
            }, {
                fields: {
                    user: true
                }
            }, (err, addressData) => {
                if (err) {
                    return callback(err);
                }

                if (!addressData) {
                    return callback(null, false);
                }

                return next(null, {
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
                    username: true,
                    password: true,
                    enabled2fa: true,
                    asp: true
                }
            }, (err, userData) => {
                if (err) {
                    return callback(err);
                }

                if (!userData) {
                    return callback(null, false);
                }

                // try master password
                if (bcrypt.compareSync(password, userData.password || '')) {
                    meta.scope = 'master';
                    this.redis
                        .multi()
                        .zadd('wl:' + userData._id.toString(), Date.now(), JSON.stringify(meta))
                        .zremrangebyscore('wl:' + userData._id.toString(), '-INF', Date.now() - 10 * 24 * 3600 * 1000)
                        .expire('wl:' + userData._id.toString(), 10 * 24 * 3600)
                        .exec(() => false);

                    return callback(null, {
                        user: userData._id,
                        username: userData.username,
                        scope: 'master',
                        enabled2fa: userData.enabled2fa
                    });
                }

                // try application specific passwords
                password = password.replace(/\s+/g, '').toLowerCase();
                if (!userData.asp || !userData.asp.length || !/^[a-z]{16}$/.test(password)) {
                    // does not look like an application specific password
                    return callback(null, false);
                }

                for (let i = 0; i < userData.asp.length; i++) {
                    let asp = userData.asp[i];
                    if (bcrypt.compareSync(password, asp.password || '')) {
                        meta.scope = asp.id.toString();
                        this.redis
                            .multi()
                            .zadd('wl:' + userData._id.toString(), Date.now(), JSON.stringify(meta))
                            .zremrangebyscore('wl:' + userData._id.toString(), '-INF', Date.now() - 10 * 24 * 3600 * 1000)
                            .expire('wl:' + userData._id.toString(), 10 * 24 * 3600)
                            .exec(() => false);

                        return callback(null, {
                            user: userData._id,
                            username: userData.username,
                            scope: 'application',
                            enabled2fa: false // application scope never requires 2FA
                        });
                    }
                }

                return callback(null, false);
            });
        });
    }

    generateASP(data, callback) {
        let password = generatePassword.generate({
            length: 16,
            uppercase: false,
            numbers: false,
            symbols: false
        });

        let passwordEntry = {
            id: new ObjectID(),
            description: data.description,
            created: new Date(),
            password: bcrypt.hashSync(password, 11)
        };

        // register this address as the default address for that user
        return this.users.collection('users').findOneAndUpdate({
            username: data.username
        }, {
            $push: {
                asp: passwordEntry
            }
        }, {}, (err, result) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL username=%s error=%s', data.username, err.message);
                return callback(new Error('Database Error, failed to update user'));
            }
            if (!result || !result.value) {
                return callback(new Error('User not found'));
            }

            passwordEntry.password = password;
            return callback(null, passwordEntry);
        });
    }

    create(data, callback) {
        this.users.collection('users').findOne({
            username: data.username
        }, {
            fields: {
                username: true
            }
        }, (err, userData) => {
            if (err) {
                log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                return callback(new Error('Database Error, failed to create user'));
            }

            if (userData) {
                let err = new Error('This username already exists');
                err.fields = {
                    username: err.message
                };
                return callback(err);
            }

            let junkRetention = consts.JUNK_RETENTION;

            // Insert
            let hash = data.password ? bcrypt.hashSync(data.password, 11) : '';
            let id = new ObjectID();
            this.users.collection('users').insertOne({
                _id: id,

                username: data.username,
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

                filters: [],

                // default retention for user mailboxes
                retention: data.retention || 0,

                created: new Date(),

                // until setup value is not true, this account is not usable
                setup: false
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
                        created: new Date()
                    }, err => {
                        if (err) {
                            // try to rollback
                            this.users.collection('users').deleteOne({ _id: id }, () => false);
                            this.database.collection('mailboxes').deleteMany({ user: id }, () => false);

                            log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                            return callback(new Error('Database Error, failed to create user'));
                        }

                        // register this address as the default address for that user
                        return this.users.collection('users').findOneAndUpdate({
                            _id: id,
                            setup: false
                        }, {
                            $set: {
                                password: hash,
                                address,
                                setup: true
                            }
                        }, {}, err => {
                            if (err) {
                                // try to rollback
                                this.users.collection('users').deleteOne({ _id: id }, () => false);
                                this.database.collection('mailboxes').deleteMany({ user: id }, () => false);

                                log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                                return callback(new Error('Database Error, failed to create user'));
                            }

                            return callback(null, id);
                        });
                    });
                });
            });
        });
    }

    reset(username, callback) {
        let password = generatePassword.generate({
            length: 12,
            uppercase: true,
            numbers: true,
            symbols: false
        });

        return this.users.collection('users').findOneAndUpdate({
            username
        }, {
            $set: {
                enabled2fa: false,
                seed: '',
                requirePasswordChange: true,
                password: bcrypt.hashSync(password, 11)
            }
        }, {}, (err, result) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL username=%s error=%s', username, err.message);
                return callback(new Error('Database Error, failed to reset user credentials'));
            }

            if (!result || !result.value) {
                return callback(new Error('Could not update user'));
            }

            return callback(null, password);
        });
    }

    setup2fa(username, issuer, callback) {
        return this.users.collection('users').findOne({
            username
        }, {
            fields: {
                enabled2fa: true,
                seed: true
            }
        }, (err, entry) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL username=%s error=%s', username, err.message);
                return callback(new Error('Database Error, failed to check user'));
            }

            if (!entry) {
                return callback(new Error('Could not find user data'));
            }

            if (entry.enabled2fa) {
                return callback(new Error('2FA is already enabled for this user'));
            }

            if (entry.seed) {
                let otpauth_url = speakeasy.otpauthURL({
                    secret: base32.decode(entry.seed),
                    label: username,
                    issuer
                });
                return QRCode.toDataURL(otpauth_url, (err, data_url) => {
                    if (err) {
                        log.error('DB', 'QRFAIL username=%s error=%s', username, err.message);
                        return callback(new Error('Failed to generate QR code'));
                    }
                    return callback(null, data_url);
                });
            }

            let secret = speakeasy.generateSecret({
                length: 20,
                name: username
            });

            return this.users.collection('users').findOneAndUpdate({
                username,
                enabled2fa: false
            }, {
                $set: {
                    seed: secret.base32
                }
            }, {}, (err, result) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL username=%s error=%s', username, err.message);
                    return callback(new Error('Database Error, failed to update user'));
                }

                if (!result || !result.value) {
                    return callback(new Error('Could not update user, check if 2FA is not already enabled'));
                }

                let otpauth_url = speakeasy.otpauthURL({
                    secret: secret.ascii,
                    label: username,
                    issuer
                });

                QRCode.toDataURL(otpauth_url, (err, data_url) => {
                    if (err) {
                        log.error('DB', 'QRFAIL username=%s error=%s', username, err.message);
                        return callback(new Error('Failed to generate QR code'));
                    }
                    return callback(null, data_url);
                });
            });
        });
    }

    enable2fa(username, userToken, callback) {
        this.check2fa(username, userToken, (err, verified) => {
            if (err) {
                return callback(err);
            }
            if (!verified) {
                return callback(null, false);
            }

            // token was valid, update user settings
            return this.users.collection('users').findOneAndUpdate({
                username
            }, {
                $set: {
                    enabled2fa: true
                }
            }, {}, (err, result) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL username=%s error=%s', username, err.message);
                    return callback(new Error('Database Error, failed to update user'));
                }

                if (!result || !result.value) {
                    return callback(new Error('Could not update user, check if 2FA is not already enabled'));
                }

                return callback(null, true);
            });
        });
    }

    disable2fa(username, callback) {
        return this.users.collection('users').findOneAndUpdate({
            username
        }, {
            $set: {
                enabled2fa: false,
                seed: ''
            }
        }, {}, (err, result) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL username=%s error=%s', username, err.message);
                return callback(new Error('Database Error, failed to update user'));
            }

            if (!result || !result.value) {
                return callback(new Error('Could not update user, check if 2FA is not already disabled'));
            }

            return callback(null, true);
        });
    }

    check2fa(username, userToken, callback) {
        this.users.collection('users').findOne({
            username
        }, {
            fields: {
                username: true,
                seed: true
            }
        }, (err, userData) => {
            if (err) {
                log.error('DB', 'LOADFAIL username=%s error=%s', username, err.message);
                return callback(new Error('Database Error, failed to update user'));
            }
            if (!userData) {
                let err = new Error('This username does not exist');
                err.fields = {
                    username: err.message
                };
                return callback(err);
            }

            if (!userData.seed) {
                // 2fa not set up
                return callback(null, true);
            }

            let verified = speakeasy.totp.verify({
                secret: userData.seed,
                encoding: 'base32',
                token: userToken,
                window: 6
            });

            return callback(null, verified);
        });
    }

    update(data, callback) {
        let query = {
            username: data.username
        };

        if (data.resetPassword) {
            query.requirePasswordChange = true;
        }

        this.users.collection('users').findOne(query, {
            fields: {
                username: true,
                password: true
            }
        }, (err, userData) => {
            if (err) {
                log.error('DB', 'UPDATEFAIL username=%s error=%s', data.username, err.message);
                return callback(new Error('Database Error, failed to update user'));
            }
            if (!userData) {
                let err = new Error('This username does not exist');
                err.fields = {
                    username: err.message
                };
                return callback(err);
            }

            if (!data.resetPassword && data.oldpassword && !bcrypt.compareSync(data.oldpassword, userData.password || '')) {
                let err = new Error('Password does not match');
                err.fields = {
                    oldpassword: err.message
                };
                return callback(err);
            }

            let update = {};

            if (data.hasOwnProperty('name')) {
                update.name = data.name || '';
            }

            if (data.hasOwnProperty('forward')) {
                update.forward = data.forward || '';
            }

            if (data.hasOwnProperty('targetUrl')) {
                update.targetUrl = data.targetUrl || '';
            }

            if (data.hasOwnProperty('autoreply')) {
                update.autoreply = data.autoreply || '';
            }

            if (data.password) {
                update.password = bcrypt.hashSync(data.password, 11);
            }

            if (data.resetPassword) {
                update.requirePasswordChange = false;
            }

            return this.users.collection('users').findOneAndUpdate({
                _id: userData._id
            }, {
                $set: update
            }, {}, err => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL username=%s error=%s', data.username, err.message);
                    return callback(new Error('Database Error, failed to update user'));
                }

                return callback(null, userData._id);
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
}

module.exports = UserHandler;
