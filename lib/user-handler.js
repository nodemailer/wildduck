'use strict';

const config = require('config');
const log = require('npmlog');
const bcrypt = require('bcryptjs');
const speakeasy = require('speakeasy');
const QRCode = require('qrcode');
const tools = require('./tools');
const ObjectID = require('mongodb').ObjectID;
const generatePassword = require('generate-password');

const MAX_STORAGE = 1 * (1024 * 1024 * 1024);
const MAX_RECIPIENTS = 2000;

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
    constructor(database) {
        this.database = database;
    }

    /**
     * Authenticate user
     *
     * @param {String} username Either username or email address
     */
    authenticate(username, password, callback) {
        let checkAddress = next => {
            if (username.indexOf('@') < 0) {
                // assume regular username
                return next(null, {
                    username
                });
            }

            // try to find existing email address
            let address = tools.normalizeAddress(username);
            this.database.collection('addresses').findOne({
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

            this.database.collection('users').findOne(query, {
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
        return this.database.collection('users').findOneAndUpdate({
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

            return callback(null, password);
        });
    }

    create(data, callback) {
        this.database.collection('users').findOne({
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

            // Insert
            let hash = bcrypt.hashSync(data.password, 11);
            this.database.collection('users').insertOne({
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
                quota: data.maxStorage || MAX_STORAGE,
                recipients: data.maxRecipients || MAX_RECIPIENTS,


                filters: [],

                created: new Date(),

                // until setup value is not true, this account is not usable
                setup: false
            }, (err, result) => {
                if (err) {
                    log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                    return callback(new Error('Database Error, failed to create user'));
                }

                let user = result.insertedId;

                let mailboxes = this.getMailboxes(data.language).map(mailbox => {
                    mailbox.user = user;
                    return mailbox;
                });

                this.database.collection('mailboxes').insertMany(mailboxes, {
                    w: 1,
                    ordered: false
                }, err => {
                    if (err) {
                        log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                        return callback(new Error('Database Error, failed to create user'));
                    }

                    // insert alias address to email address registry
                    this.database.collection('addresses').insertOne({
                        user,
                        address: data.username + '@' + config.emailDomain,
                        created: new Date()
                    }, err => {
                        if (err) {
                            log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                            return callback(new Error('Database Error, failed to create user'));
                        }

                        // register this address as the default address for that user
                        return this.database.collection('users').findOneAndUpdate({
                            _id: user
                        }, {
                            $set: {
                                password: hash,
                                address: data.username + '@' + config.emailDomain,
                                setup: true
                            }
                        }, {}, err => {
                            if (err) {
                                log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                                return callback(new Error('Database Error, failed to create user'));
                            }

                            return callback(null, user);
                        });
                    });
                });
            });
        });
    }

    setup2fa(username, callback) {
        let secret = speakeasy.generateSecret({
            length: 20
        });

        return this.database.collection('users').findOneAndUpdate({
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

            QRCode.toDataURL(secret.otpauth_url, (err, data_url) => {
                if (err) {
                    log.error('DB', 'QRFAIL username=%s error=%s', username, err.message);
                    return callback(new Error('Failed to generate QR code'));
                }
                return callback(null, data_url);
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
            return this.database.collection('users').findOneAndUpdate({
                username,
                enabled2fa: false
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

    disable2fa(username, userToken, callback) {
        this.check2fa(username, userToken, (err, verified) => {
            if (err) {
                return callback(err);
            }
            if (!verified) {
                return callback(null, false);
            }

            // token was valid, update user settings
            return this.database.collection('users').findOneAndUpdate({
                username,
                enabled2fa: true
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
        });
    }

    check2fa(username, userToken, callback) {
        this.database.collection('users').findOne({
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
                token: userToken
            });

            return callback(null, verified);
        });
    }

    update(data, callback) {
        this.database.collection('users').findOne({
            username: data.username
        }, {
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

            if (data.oldpassword && !bcrypt.compareSync(data.oldpassword, userData.password || '')) {
                let err = new Error('Password does not match');
                err.fields = {
                    oldpassword: err.message
                };
                return callback(err);
            }

            let update = {
                name: data.name
            };

            if (data.password) {
                update.password = bcrypt.hashSync(data.password, 11);
            }

            return this.database.collection('users').findOneAndUpdate({
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

        let defaultMailboxes = [{
            path: 'INBOX'
        }, {
            specialUse: '\\Sent'
        }, {
            specialUse: '\\Trash'
        }, {
            specialUse: '\\Drafts'
        }, {
            specialUse: '\\Junk'
        }, {
            specialUse: '\\Archive'
        }];

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
