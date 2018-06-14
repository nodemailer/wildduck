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
const u2f = require('u2f');
const UserCache = require('./user-cache');
const isemail = require('isemail');

class UserHandler {
    constructor(options) {
        this.database = options.database;
        this.users = options.users || options.database;
        this.redis = options.redis;
        this.messageHandler = options.messageHandler;
        this.counters = this.messageHandler ? this.messageHandler.counters : counters(this.redis);

        this.userCache = new UserCache({
            users: this.users,
            redis: this.redis
        });

        if (!('authlogExpireDays' in options)) {
            this.authlogExpireDays = 30;
        } else {
            this.authlogExpireDays = options.authlogExpireDays;
        }
    }

    resolveAddress(address, options, callback) {
        options = options || {};
        let wildcard = !!options.wildcard;

        address = tools.normalizeAddress(address, false, { removeLabel: true, removeDots: true });

        let username = address.substr(0, address.indexOf('@'));
        let domain = address.substr(address.indexOf('@') + 1);

        let fields = {
            user: true,
            targets: true
        };

        Object.keys(options.fields || {}).forEach(key => {
            fields[key] = true;
        });

        // try exact match
        this.users.collection('addresses').findOne(
            {
                addrview: username + '@' + domain
            },
            {
                fields
            },
            (err, addressData) => {
                if (err) {
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (addressData) {
                    return callback(null, addressData);
                }

                let aliasDomain;
                // try an alias
                let checkAliases = done => {
                    this.users.collection('domainaliases').findOne({ alias: domain }, (err, aliasData) => {
                        if (err) {
                            return done(err);
                        }
                        if (!aliasData) {
                            return done();
                        }

                        aliasDomain = aliasData.domain;

                        this.users.collection('addresses').findOne(
                            {
                                addrview: username + '@' + aliasDomain
                            },
                            {
                                fields
                            },
                            done
                        );
                    });
                };

                checkAliases((err, addressData) => {
                    if (err) {
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }

                    if (addressData) {
                        return callback(null, addressData);
                    }

                    if (!wildcard) {
                        return callback(null, false);
                    }

                    let query = {
                        addrview: '*@' + domain
                    };

                    if (aliasDomain) {
                        // search for alias domain as well
                        query.addrview = { $in: [query.addrview, '*@' + aliasDomain] };
                    }

                    // try to find a catch-all address
                    this.users.collection('addresses').findOne(
                        query,
                        {
                            fields
                        },
                        (err, addressData) => {
                            if (err) {
                                err.code = 'InternalDatabaseError';
                                return callback(err);
                            }

                            if (addressData) {
                                return callback(null, addressData);
                            }

                            // try to find a catch-all user (eg. "postmaster@*")
                            this.users.collection('addresses').findOne(
                                {
                                    addrview: username + '@*'
                                },
                                {
                                    fields
                                },
                                (err, addressData) => {
                                    if (err) {
                                        err.code = 'InternalDatabaseError';
                                        return callback(err);
                                    }

                                    if (!addressData) {
                                        return callback(null, false);
                                    }

                                    return callback(null, addressData);
                                }
                            );
                        }
                    );
                });
            }
        );
    }

    /**
     * Reolve user by username/address
     *
     * @param {String} username Either username or email address
     * @param {Object} [extraFields] Optional projection fields object
     */
    get(username, extraFields, callback) {
        if (!callback && typeof extraFields === 'function') {
            callback = extraFields;
            extraFields = false;
        }

        let fields = {
            _id: true,
            quota: true,
            storageUsed: true,
            disabled: true
        };

        Object.keys(extraFields || {}).forEach(field => {
            fields[field] = true;
        });

        let checkAddress = next => {
            if (tools.isId(username)) {
                return next(null, {
                    query: { _id: new ObjectID(username) }
                });
            }

            if (username.indexOf('@') < 0) {
                // assume regular username
                return next(null, {
                    query: { unameview: tools.uview(username) }
                });
            }

            this.resolveAddress(username, { fields: { name: true } }, (err, addressData) => {
                if (err) {
                    return callback(err);
                }
                if (addressData.user) {
                    return next(null, { query: { _id: addressData.user }, addressData });
                }
                return callback(null, false);
            });
        };

        checkAddress((err, data) => {
            if (err) {
                return callback(err);
            }

            this.users.collection('users').findOne(
                data.query,
                {
                    fields
                },
                (err, userData) => {
                    if (err) {
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }

                    if (userData && fields.name && data.addressData) {
                        // override name
                        userData.name = data.addressData.name || userData.name;
                    }

                    return callback(null, userData);
                }
            );
        });
    }

    /**
     * rateLimitIP
     * if ip is not available will always return success object
     * @param  {Object}   meta
     * @param  {String}   meta.ip  request remote ip address
     * @param  {Integer}  count
     * @param  {Function} callback
     */
    rateLimitIP(meta, count, callback) {
        if (meta.ip) {
            return this.counters.ttlcounter('auth_ip:' + meta.ip, count, consts.IP_AUTH_FAILURES, consts.IP_AUTH_WINDOW, callback);
        }
        return callback(null, { success: true });
    }

    /**
     * rateLimitUser
     * @param  {String}   tokenID  user identifier
     * @param  {Integer}  count
     * @param  {Function} callback
     */
    rateLimitUser(tokenID, count, callback) {
        this.counters.ttlcounter('auth_user:' + tokenID, count, consts.USER_AUTH_FAILURES, consts.USER_AUTH_WINDOW, callback);
    }

    /**
     * rateLimitReleaseUser
     * @param  {String}   tokenID  user identifier
     * @param  {Integer}  count
     * @param  {Function} callback
     */
    rateLimitReleaseUser(tokenID, callback) {
        this.redis.del('auth_user:' + tokenID, callback);
    }

    /**
     * rateLimit
     * @param  {String}   tokenID  user identifier
     * @param  {Object}   meta
     * @param  {String}   meta.ip  request remote ip address
     * @param  {Integer}  count
     * @param  {Function} callback
     */
    rateLimit(tokenID, meta, count, callback) {
        this.rateLimitIP(meta, count, (err, ipRes) => {
            if (err) {
                return callback(err);
            }

            this.rateLimitUser(tokenID, count, (err, userRes) => {
                if (err) {
                    return callback(err);
                }
                if (!ipRes.success) {
                    return callback(null, ipRes);
                }
                return callback(null, userRes);
            });
        });
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

        this.rateLimitIP(meta, 0, (err, res) => {
            if (err) {
                err.code = 'InternalDatabaseError';
                return callback(err);
            }

            if (!res.success) {
                return rateLimitResponse(res, callback);
            }

            this.checkAddress(username, (err, query) => {
                if (err) {
                    return callback(err);
                }

                if (!query) {
                    meta.username = username;
                    meta.result = 'unknown';
                    return this.logAuthEvent(null, meta, () => callback(null, false));
                }

                this.users.collection('users').findOne(
                    query,
                    {
                        fields: {
                            _id: true,
                            username: true,
                            tempPassword: true,
                            password: true,
                            enabled2fa: true,
                            u2f: true,
                            disabled: true
                        }
                    },
                    (err, userData) => {
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!userData) {
                            if (query.unameview) {
                                meta.username = query.unameview;
                            } else {
                                meta.user = query._id;
                            }
                            meta.result = 'unknown';
                            return this.logAuthEvent(null, meta, () => {
                                // rate limit failed authentication attempts against non-existent users as well
                                let ustring = (query.unameview || query._id || '').toString();

                                this.rateLimit(ustring, meta, 1, (err, res) => {
                                    if (err) {
                                        err.code = 'InternalDatabaseError';
                                        return callback(err);
                                    }
                                    if (!res.success) {
                                        return rateLimitResponse(res, callback);
                                    }
                                    callback(null, false);
                                });
                            });
                        }

                        this.rateLimitUser(userData._id, 0, (err, res) => {
                            if (err) {
                                err.code = 'InternalDatabaseError';
                                return callback(err);
                            }
                            if (!res.success) {
                                return rateLimitResponse(res, callback);
                            }

                            if (userData.disabled) {
                                // disabled users can not log in
                                meta.result = 'disabled';
                                return this.logAuthEvent(userData._id, meta, () => callback(null, false));
                            }

                            let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                            let getU2fAuthRequest = done => {
                                if (!enabled2fa.includes('u2f') || !userData.u2f || !userData.u2f.keyHandle) {
                                    return done(null, false);
                                }
                                this.generateU2fAuthRequest(userData._id, userData.u2f.keyHandle, done);
                            };

                            let authSuccess = (...args) => {
                                // clear rate limit counter on success
                                this.rateLimitReleaseUser(userData._id, () => false);
                                callback(...args);
                            };

                            let authFail = (...args) => {
                                // increment rate limit counter on failure
                                this.rateLimit(userData._id, meta, 1, () => {
                                    callback(...args);
                                });
                            };

                            let requirePasswordChange = false;
                            let usingTemporaryPassword = false;

                            let checkMasterPassword = next => {
                                let checkAccountPassword = () => {
                                    bcrypt.compare(password, userData.password || '', next);
                                };

                                if (userData.tempPassword && userData.tempPassword.created > new Date(Date.now() - 24 * 3600 * 1000)) {
                                    // try temporary password
                                    return bcrypt.compare(password, userData.tempPassword.password || '', (err, success) => {
                                        if (err) {
                                            return next(err);
                                        }
                                        if (success) {
                                            if (userData.validAfter > new Date()) {
                                                let err = new Error('Temporary password is not yet activated');
                                                err.code = 'TempPasswordNotYetValid';
                                                return next(err);
                                            }

                                            requirePasswordChange = true;
                                            usingTemporaryPassword = true;
                                            return next(null, true);
                                        }

                                        checkAccountPassword();
                                    });
                                }
                                checkAccountPassword();
                            };

                            // try master password
                            checkMasterPassword((err, success) => {
                                if (err) {
                                    err.code = err.code || 'BcryptError';
                                    return callback(err);
                                }

                                if (success) {
                                    meta.result = 'success';
                                    meta.source = !usingTemporaryPassword ? 'master' : 'temporary';

                                    if (enabled2fa.length) {
                                        meta.require2fa = enabled2fa.length ? enabled2fa.join(',') : false;
                                    }

                                    if (requiredScope !== 'master' && (enabled2fa.length || usingTemporaryPassword)) {
                                        // master password can not be used for other stuff if 2FA is enabled
                                        // temporary password is only valid for master
                                        meta.result = 'fail';
                                        let err = new Error('Authentication failed. Invalid scope');
                                        err.response = 'NO'; // imap response code
                                        return this.logAuthEvent(userData._id, meta, () => authFail(err));
                                    }

                                    return this.logAuthEvent(userData._id, meta, () => {
                                        let authResponse = {
                                            user: userData._id,
                                            username: userData.username,
                                            scope: meta.scope,
                                            // if 2FA is enabled then require token validation
                                            require2fa: enabled2fa.length && !usingTemporaryPassword ? enabled2fa : false,
                                            requirePasswordChange // true, if password was reset and using temporary password
                                        };

                                        if (enabled2fa.length && !usingTemporaryPassword) {
                                            authResponse.enabled2fa = enabled2fa;

                                            return getU2fAuthRequest((err, u2fAuthRequest) => {
                                                if (err) {
                                                    log.error('DB', 'U2FREFAIL u2fAuthRequest id=%s error=%s', userData._id, err.message);
                                                }
                                                if (u2fAuthRequest) {
                                                    authResponse.u2fAuthRequest = u2fAuthRequest;
                                                }
                                                authSuccess(null, authResponse);
                                            });
                                        }

                                        authSuccess(null, authResponse);
                                    });
                                }

                                if (requiredScope === 'master') {
                                    // only master password can be used for management tasks
                                    meta.result = 'fail';
                                    meta.source = 'master';
                                    return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                                }

                                // try application specific passwords
                                password = password.replace(/\s+/g, '').toLowerCase();

                                if (!/^[a-z]{16}$/.test(password)) {
                                    // does not look like an application specific password
                                    meta.result = 'fail';
                                    meta.source = 'master';
                                    return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                                }

                                let selector = getStringSelector(password);

                                this.users
                                    .collection('asps')
                                    .find({
                                        user: userData._id
                                    })
                                    .toArray((err, asps) => {
                                        if (err) {
                                            err.code = 'InternalDatabaseError';
                                            return callback(err);
                                        }

                                        if (!asps || !asps.length) {
                                            // user does not have app specific passwords set
                                            meta.result = 'fail';
                                            meta.source = 'master';
                                            return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                                        }

                                        let pos = 0;
                                        let checkNext = () => {
                                            if (pos >= asps.length) {
                                                meta.result = 'fail';
                                                meta.source = 'master';
                                                return this.logAuthEvent(userData._id, meta, () => authFail(null, false));
                                            }

                                            let asp = asps[pos++];
                                            if (asp.selector && asp.selector !== selector) {
                                                // no need to check, definitely a wrong one
                                                return setImmediate(checkNext);
                                            }

                                            bcrypt.compare(password, asp.password || '', (err, success) => {
                                                if (err) {
                                                    err.code = 'BcryptError';
                                                    return callback(err);
                                                }

                                                if (!success) {
                                                    return setImmediate(checkNext);
                                                }

                                                if (!asp.scopes.includes('*') && !asp.scopes.includes(requiredScope)) {
                                                    meta.result = 'fail';
                                                    meta.source = 'asp';
                                                    meta.asp = asp._id;
                                                    meta.aname = asp.description;

                                                    return this.logAuthEvent(userData._id, meta, () =>
                                                        authFail(new Error('Authentication failed. Invalid scope'))
                                                    );
                                                }

                                                meta.result = 'success';
                                                meta.source = 'asp';
                                                meta.asp = asp._id;
                                                meta.aname = asp.description;

                                                this.logAuthEvent(userData._id, meta, (err, r) => {
                                                    if (err) {
                                                        // don't really care
                                                    }
                                                    this.rateLimitReleaseUser(userData._id, () => false);
                                                    this.users.collection('asps').findOneAndUpdate(
                                                        {
                                                            _id: asp._id
                                                        },
                                                        {
                                                            $set: {
                                                                used: new Date(),
                                                                authEvent: r.insertedId
                                                            }
                                                        },
                                                        () => {
                                                            authSuccess(null, {
                                                                user: userData._id,
                                                                username: userData.username,
                                                                scope: requiredScope,
                                                                asp: asp._id.toString(),
                                                                require2fa: false // application scope never requires 2FA
                                                            });
                                                        }
                                                    );
                                                });
                                            });
                                        };

                                        checkNext();
                                    });
                            });
                        });
                    }
                );
            });
        });
    }

    /**
     * Authenticate user using an older password. Needed for account recovery.
     * TODO: check if this is even used anywhere?
     *
     * @param {String} username Either username or email address
     */
    authenticateUsingOldPassword(username, password, callback) {
        if (!password) {
            // do not allow signing in without a password
            return callback(null, false);
        }

        this.checkAddress(username, (err, query) => {
            if (err) {
                return callback(err);
            }

            if (!query) {
                return callback(null, false);
            }

            this.users.collection('users').findOne(
                query,
                {
                    fields: {
                        _id: true,
                        username: true,
                        oldPasswords: true,
                        disabled: true
                    }
                },
                (err, userData) => {
                    if (err) {
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }

                    if (!userData) {
                        return callback(null, false);
                    }

                    if (userData.disabled) {
                        return callback(null, false);
                    }

                    // FIXME: use IP in rlkey
                    let rlkey = 'outh:' + userData._id.toString();
                    this.counters.ttlcounter(rlkey, 0, consts.USER_AUTH_FAILURES, consts.USER_AUTH_WINDOW, (err, res) => {
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }
                        if (!res.success) {
                            return rateLimitResponse(res, callback);
                        }

                        let authSuccess = (...args) => {
                            // clear rate limit counter on success
                            this.redis.del(rlkey, () => false);
                            callback(...args);
                        };

                        let authFail = (...args) => {
                            // increment rate limit counter on failure
                            this.counters.ttlcounter(rlkey, 1, consts.USER_AUTH_FAILURES, consts.USER_AUTH_WINDOW, () => {
                                callback(...args);
                            });
                        };

                        if (!userData.oldPasswords || !userData.oldPasswords.length) {
                            return authFail(null, false);
                        }

                        // do not check too many passwords
                        if (userData.oldPasswords.length > 30) {
                            userData.oldPasswords = userData.oldPasswords.slice(-30);
                        }

                        let curPos = 0;
                        let checkNext = () => {
                            if (curPos >= userData.oldPasswords.length) {
                                return authFail(null, false);
                            }
                            let oldPassword = userData.oldPasswords[curPos++];

                            bcrypt.compare(password, oldPassword.hash || '', (err, success) => {
                                if (err) {
                                    err.code = 'BcryptError';
                                    return callback(err);
                                }

                                if (!success) {
                                    return setImmediate(checkNext);
                                }

                                return authSuccess(null, userData._id);
                            });
                        };

                        return setImmediate(checkNext);
                    });
                }
            );
        });
    }

    generateU2fAuthRequest(user, keyHandle, callback) {
        let authRequest;
        try {
            authRequest = u2f.request(config.u2f.appId, keyHandle);
        } catch (E) {
            log.error('U2F', 'U2FFAIL request id=%s error=%s', user, E.message);
        }

        if (!authRequest) {
            return callback(null, false);
        }

        this.redis
            .multi()
            .set('u2f:auth:' + user, JSON.stringify(authRequest))
            .expire('u2f:auth:' + user, 1 * 3600)
            .exec((err, results) => {
                if ((!err && !results) || !results[0]) {
                    err = new Error('Invalid DB response');
                } else if (!err && results && results[0] && results[0][0]) {
                    err = results[0][0];
                }
                if (err) {
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                callback(null, authRequest);
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
        let selector = getStringSelector(password);

        let allowedScopes = [...consts.SCOPES];
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

        bcrypt.hash(password, consts.BCRYPT_ROUNDS, (err, hash) => {
            if (err) {
                log.error('DB', 'HASHFAIL generateASP id=%s error=%s', user, err.message);
                err.code = 'BcryptError';
                return callback(err);
            }

            let passwordData = {
                id: new ObjectID(),
                user,
                description: data.description,
                scopes,
                password: hash,
                selector,
                created: new Date()
            };

            // register this address as the default address for that user
            return this.users.collection('users').findOne(
                {
                    _id: user
                },
                {
                    fields: {
                        _id: true
                    }
                },
                (err, userData) => {
                    if (err) {
                        log.error('DB', 'DBFAIL generateASP id=%s error=%s', user, err.message);
                        err.message = 'Database Error, failed to find user';
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }
                    if (!userData) {
                        return callback(new Error('User not found'));
                    }

                    this.users.collection('asps').insertOne(passwordData, err => {
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }
                        return this.logAuthEvent(
                            user,
                            {
                                action: 'create asp',
                                asp: passwordData._id,
                                aname: passwordData.description,
                                result: 'success',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () =>
                                callback(null, {
                                    id: passwordData._id,
                                    password
                                })
                        );
                    });
                }
            );
        });
    }

    deleteASP(user, asp, data, callback) {
        return this.users.collection('asps').findOne(
            {
                _id: asp,
                user
            },
            (err, asp) => {
                if (err) {
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (!asp) {
                    let err = new Error('Application Specific Password was not found');
                    err.code = 'AspNotFound';
                    return callback(err);
                }

                this.users.collection('asps').deleteOne({ _id: asp._id }, (err, r) => {
                    if (err) {
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }

                    if (r.deletedCount) {
                        return this.logAuthEvent(
                            user,
                            {
                                action: 'delete asp',
                                asp: asp._id,
                                aname: asp.description,
                                result: 'success',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => callback(null, true)
                        );
                    } else {
                        return callback(null, true);
                    }
                });
            }
        );
    }

    create(data, callback) {
        this.users.collection('users').findOne(
            {
                username: data.username.replace(/\./g, '')
            },
            {
                fields: {
                    unameview: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                    err.message = 'Database Error, failed to create user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (userData) {
                    let err = new Error('This username already exists');
                    err.code = 'UserExistsError';
                    return callback(err);
                }

                let address = data.address ? data.address : false;

                if (!address) {
                    try {
                        if (isemail.validate(data.username)) {
                            address = data.username;
                        }
                    } catch (E) {
                        // ignore
                    }
                }

                if (!address) {
                    address = data.username.split('@').shift() + '@' + (config.emailDomain || os.hostname()).toLowerCase();
                }

                address = tools.normalizeAddress(address, false, { removeLabel: true });
                let addrview = tools.uview(address);

                let checkAddress = done => {
                    if (data.emptyAddress) {
                        return done();
                    }

                    this.users.collection('addresses').findOne(
                        {
                            addrview
                        },
                        {
                            fields: {
                                _id: true
                            }
                        },
                        (err, addressData) => {
                            if (err) {
                                log.error('DB', 'CREATEFAIL username=%s address=%s error=%s', data.username, address, err.message);
                                err.message = 'Database Error, failed to create user';
                                err.code = 'InternalDatabaseError';
                                return callback(err);
                            }

                            if (addressData) {
                                let err = new Error('This address already exists');
                                err.code = 'AddressExistsError';
                                return callback(err);
                            }

                            done();
                        }
                    );
                };

                checkAddress(() => {
                    let junkRetention = consts.JUNK_RETENTION;

                    // Insert user data

                    let hashPassword = done => {
                        if (!data.password) {
                            // Users with an empty password can not log in
                            return done();
                        }
                        bcrypt.hash(data.password, consts.BCRYPT_ROUNDS, done);
                    };

                    hashPassword((err, hash) => {
                        if (err) {
                            log.error('DB', 'HASHFAIL user.create id=%s error=%s', data.username, err.message);
                            err.code = 'BcryptError';
                            return callback(err);
                        }

                        let id = new ObjectID();

                        // spamLevel is from 0 (everything is spam) to 100 (accept everything)
                        let spamLevel = 'spamLevel' in data && !isNaN(data.spamLevel) ? Number(data.spamLevel) : 50;
                        if (spamLevel < 0) {
                            spamLevel = 0;
                        }
                        if (spamLevel > 100) {
                            spamLevel = 100;
                        }

                        userData = {
                            _id: id,

                            username: data.username,
                            // dotless version
                            unameview: tools.uview(data.username),

                            name: data.name,

                            // security
                            password: '', // set this later. having no password prevents login

                            enabled2fa: [],
                            seed: '', // 2fa seed value

                            // default email address
                            address: '', // set this later

                            // quota
                            storageUsed: 0,
                            quota: data.quota || 0,

                            recipients: data.recipients || 0,
                            forwards: data.forwards || 0,

                            imapMaxUpload: data.imapMaxUpload || 0,
                            imapMaxDownload: data.imapMaxDownload || 0,
                            pop3MaxDownload: data.pop3MaxDownload || 0,
                            receivedMax: data.receivedMax || 0,

                            targets: [].concat(data.targets || []),

                            // autoreply status
                            // off by default, can be changed later by user through the API
                            autoreply: false,

                            pubKey: data.pubKey || '',
                            encryptMessages: !!data.encryptMessages,
                            encryptForwarded: !!data.encryptForwarded,

                            spamLevel,

                            // default retention for user mailboxes
                            retention: data.retention || 0,

                            created: new Date(),

                            // until setup value is not true, this account is not usable
                            activated: false,
                            disabled: true
                        };

                        if (data.tags && data.tags.length) {
                            userData.tags = data.tags;
                            userData.tagsview = data.tagsview;
                        }

                        this.users.collection('users').insertOne(userData, err => {
                            if (err) {
                                log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);

                                let response;
                                switch (err.code) {
                                    case 11000:
                                        response = 'Selected user already exists';
                                        err.code = 'UserExistsError';
                                        break;
                                    default:
                                        response = 'Database Error, failed to create user';
                                        err.code = 'InternalDatabaseError';
                                }

                                err.message = response;
                                return callback(err);
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

                            this.database.collection('mailboxes').insertMany(
                                mailboxes,
                                {
                                    w: 1,
                                    ordered: false
                                },
                                err => {
                                    if (err) {
                                        // try to rollback
                                        this.users.collection('users').deleteOne({ _id: id }, () => false);

                                        log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                                        err.message = 'Database Error, failed to create user';
                                        err.code = 'InternalDatabaseError';
                                        return callback(err);
                                    }

                                    let ensureAddress = done => {
                                        if (data.emptyAddress) {
                                            return done(null, '');
                                        }

                                        let addressData = {
                                            user: id,
                                            address,
                                            // dotless version
                                            addrview,
                                            created: new Date()
                                        };

                                        if (data.tags && data.tags.length && data.addTagsToAddress) {
                                            addressData.tags = data.tags;
                                            addressData.tagsview = data.tagsview;
                                        }

                                        // insert alias address to email address registry
                                        this.users.collection('addresses').insertOne(addressData, err => {
                                            if (err) {
                                                // try to rollback
                                                this.users.collection('users').deleteOne({ _id: id }, () => false);
                                                this.database.collection('mailboxes').deleteMany({ user: id }, () => false);

                                                log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);

                                                let response;
                                                switch (err.code) {
                                                    case 11000:
                                                        response = 'Selected email address already exists';
                                                        err.code = 'AddressExistsError';
                                                        break;
                                                    default:
                                                        response = 'Database Error, failed to create user';
                                                        err.code = 'InternalDatabaseError';
                                                }

                                                err.message = response;
                                                return done(err);
                                            }

                                            done(null, address);
                                        });
                                    };

                                    ensureAddress((err, address) => {
                                        if (err) {
                                            return callback(err);
                                        }

                                        let updates = {
                                            address,
                                            activated: true,
                                            disabled: false
                                        };

                                        if (data.requirePasswordChange) {
                                            updates.tempPassword = {
                                                validAfter: new Date(),
                                                password: hash,
                                                created: new Date()
                                            };
                                        } else {
                                            updates.password = hash;
                                        }

                                        // register this address as the default address for that user
                                        return this.users.collection('users').findOneAndUpdate(
                                            {
                                                _id: id,
                                                activated: false
                                            },
                                            {
                                                $set: updates
                                            },
                                            { returnOriginal: false },
                                            (err, result) => {
                                                if (err) {
                                                    // try to rollback
                                                    this.users.collection('users').deleteOne({ _id: id }, () => false);
                                                    this.database.collection('mailboxes').deleteMany({ user: id }, () => false);
                                                    this.users.collection('addresses').deleteOne({ user: id }, () => false);

                                                    log.error('DB', 'CREATEFAIL username=%s error=%s', data.username, err.message);
                                                    err.message = 'Database Error, failed to create user';
                                                    err.code = 'InternalDatabaseError';
                                                    return callback(err);
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
                                                            sess: data.sess,
                                                            ip: data.ip
                                                        },
                                                        () => callback(null, id)
                                                    );

                                                if (!this.messageHandler || data.emptyAddress) {
                                                    return createSuccess();
                                                }

                                                let parsedName = humanname.parse(userData.name || '');
                                                this.pushDefaultMessages(
                                                    userData,
                                                    {
                                                        NAME: userData.name || userData.username || address,
                                                        FNAME: parsedName.firstName,
                                                        LNAME: parsedName.lastName,
                                                        DOMAIN: address.substr(address.indexOf('@') + 1),
                                                        EMAIL: address
                                                    },
                                                    () => createSuccess()
                                                );
                                            }
                                        );
                                    });
                                }
                            );
                        });
                    });
                });
            }
        );
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
                                    time: new Date()
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

    reset(user, data, callback) {
        let password = generatePassword.generate({
            length: 12,
            uppercase: true,
            numbers: true,
            symbols: false
        });

        bcrypt.hash(password, consts.BCRYPT_ROUNDS, (err, hash) => {
            if (err) {
                log.error('DB', 'HASHFAIL user.reset id=%s error=%s', user, err.message);
                err.code = 'BcryptError';
                return callback(err);
            }

            return this.users.collection('users').findOneAndUpdate(
                {
                    _id: user
                },
                {
                    $set: {
                        tempPassword: {
                            validAfter: data.validAfter || new Date(),
                            password: hash,
                            created: new Date()
                        }
                    }
                },
                {},
                (err, result) => {
                    if (err) {
                        log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                        err.message = 'Database Error, failed to reset user credentials';
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }

                    if (!result || !result.value) {
                        return callback(new Error('Could not update user ' + user));
                    }

                    return this.logAuthEvent(
                        user,
                        {
                            action: 'reset',
                            sess: data.sess,
                            ip: data.ip
                        },
                        () => callback(null, password)
                    );
                }
            );
        });
    }

    setupTotp(user, data, callback) {
        return this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    username: true,
                    enabled2fa: true,
                    seed: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to check user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (!userData) {
                    return callback(new Error('Could not find user data'));
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (enabled2fa.includes('totp')) {
                    return callback(new Error('TOTP 2FA is already enabled for this user'));
                }

                if (!data.fresh && userData.seed) {
                    if (userData.seed) {
                        let secret = userData.seed;
                        if (userData.seed.charAt(0) === '$' && config.totp && config.totp.secret) {
                            try {
                                let decipher = crypto.createDecipher(config.totp.cipher || 'aes192', config.totp.secret);
                                secret = decipher.update(userData.seed.substr(1), 'hex', 'utf-8');
                                secret += decipher.final('utf8');
                            } catch (E) {
                                log.error('DB', 'TOTPFAIL decipher failed id=%s error=%s', user, E.message);
                                let err = new Error('Can not use decrypted secret');
                                err.code = 'InternalConfigError';
                                return callback(err);
                            }
                        }

                        let otpauth_url = speakeasy.otpauthURL({
                            secret: base32.decode(secret),
                            label: data.label || userData.username,
                            issuer: data.issuer || 'WildDuck'
                        });

                        return QRCode.toDataURL(otpauth_url, (err, data_url) => {
                            if (err) {
                                log.error('DB', 'QRFAIL username=%s error=%s', userData.username, err.message);
                                err.message = 'Failed to generate QR code';
                                err.code = 'QRError';
                                return callback(err);
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
                    try {
                        let cipher = crypto.createCipher(config.totp.cipher || 'aes192', config.totp.secret);
                        seed = '$' + cipher.update(seed, 'utf8', 'hex');
                        seed += cipher.final('hex');
                    } catch (E) {
                        log.error('DB', 'TOTPFAIL cipher failed id=%s error=%s', user, E.message);
                        let err = new Error('Database Error, failed to update user');
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }
                }

                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user,
                        enabled2fa: { $not: { $eq: 'totp' } }
                    },
                    {
                        $set: {
                            seed
                        }
                    },
                    {},
                    (err, result) => {
                        if (err) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to update user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!result || !result.value) {
                            return callback(new Error('Could not update user, check if 2FA is not already enabled'));
                        }

                        let otpauth_url = speakeasy.otpauthURL({
                            secret: secret.ascii,
                            label: data.label || userData.username,
                            issuer: data.issuer || 'WildDuck'
                        });

                        QRCode.toDataURL(otpauth_url, (err, data_url) => {
                            if (err) {
                                log.error('DB', 'QRFAIL id=%s error=%s', user, err.message);
                                err.message = 'Failed to generate QR code';
                                err.code = 'QRError';
                                return callback(err);
                            }

                            callback(null, data_url);
                        });
                    }
                );
            }
        );
    }

    enableTotp(user, data, callback) {
        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    enabled2fa: true,
                    username: true,
                    seed: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to fetch user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    let err = new Error('This username does not exist');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (!userData.seed) {
                    // 2fa not set up
                    let err = new Error('TOTP 2FA is not initialized for this user');
                    err.code = 'TotpDisabled';
                    return callback(err);
                }

                if (enabled2fa.includes('totp')) {
                    // 2fa not set up
                    let err = new Error('TOTP 2FA is already enabled for this user');
                    err.code = 'TotpEnabled';
                    return callback(err);
                }

                let secret = userData.seed;
                if (userData.seed.charAt(0) === '$' && config.totp && config.totp.secret) {
                    try {
                        let decipher = crypto.createDecipher(config.totp.cipher || 'aes192', config.totp.secret);
                        secret = decipher.update(userData.seed.substr(1), 'hex', 'utf-8');
                        secret += decipher.final('utf8');
                    } catch (E) {
                        log.error('DB', 'TOTPFAIL decipher failed id=%s error=%s', user, E.message);
                        let err = new Error('Can not use decrypted secret');
                        err.code = 'InternalConfigError';
                        return callback(err);
                    }
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
                            action: 'enable 2fa totp',
                            result: 'fail',
                            sess: data.sess,
                            ip: data.ip
                        },
                        () => callback(null, false)
                    );
                }

                let update =
                    !userData.enabled2fa || typeof userData.enabled2fa === 'boolean'
                        ? {
                              $set: {
                                  enabled2fa: ['totp']
                              }
                          }
                        : {
                              $addToSet: {
                                  enabled2fa: 'totp'
                              }
                          };

                // token was valid, update user settings
                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user,
                        seed: userData.seed
                    },
                    update,
                    {},
                    (err, result) => {
                        if (err) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to update user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!result || !result.value) {
                            err = new Error('Failed to set up 2FA. Check if it is not already enabled');
                            err.code = 'TotpEnabled';
                            return callback(err);
                        }

                        return this.logAuthEvent(
                            user,
                            {
                                action: 'enable 2fa totp',
                                result: 'success',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => callback(null, true)
                        );
                    }
                );
            }
        );
    }

    disableTotp(user, data, callback) {
        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    enabled2fa: true,
                    username: true,
                    seed: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to update user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    let err = new Error('This username does not exist');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (!enabled2fa.includes('totp')) {
                    let err = new Error('Could not update user, check if 2FA TOTP is not already disabled');
                    err.code = 'TotpDisabled';
                    return callback(err);
                }

                let update =
                    !userData.enabled2fa || typeof userData.enabled2fa === 'boolean'
                        ? {
                              $set: {
                                  enabled2fa: [],
                                  seed: ''
                              }
                          }
                        : {
                              $pull: {
                                  enabled2fa: 'totp'
                              },
                              $set: {
                                  seed: ''
                              }
                          };

                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user
                    },
                    update,
                    {},
                    (err, result) => {
                        if (err) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to update user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!result || !result.value) {
                            let err = new Error('This username does not exist');
                            err.code = 'UserNotFound';
                            return callback(err);
                        }

                        return this.logAuthEvent(
                            user,
                            {
                                action: 'disable 2fa totp',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => callback(null, true)
                        );
                    }
                );
            }
        );
    }

    checkTotp(user, data, callback) {
        let userRlKey = 'totp:' + user;
        this.rateLimit(userRlKey, data, 0, (err, res) => {
            if (err) {
                err.code = 'InternalDatabaseError';
                return callback(err);
            }
            if (!res.success) {
                return rateLimitResponse(res, callback);
            }

            let authSuccess = (...args) => {
                // clear rate limit counter on success
                this.rateLimitReleaseUser(userRlKey, () => false);
                callback(...args);
            };

            let authFail = (...args) => {
                // increment rate limit counter on failure
                this.rateLimit(userRlKey, data, 1, () => {
                    callback(...args);
                });
            };

            this.users.collection('users').findOne(
                {
                    _id: user
                },
                {
                    fields: {
                        username: true,
                        enabled2fa: true,
                        seed: true
                    }
                },
                (err, userData) => {
                    if (err) {
                        log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                        err.message = 'Database Error, failed to find user';
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }
                    if (!userData) {
                        let err = new Error('This user does not exist');
                        err.code = 'UserNotFound';
                        return callback(err);
                    }

                    let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                    if (!userData.seed || !enabled2fa.includes('totp')) {
                        // 2fa not set up
                        let err = new Error('2FA TOTP is not enabled for this user');
                        err.code = 'TotpDisabled';
                        return callback(err);
                    }

                    let secret = userData.seed;
                    if (userData.seed.charAt(0) === '$' && config.totp && config.totp.secret) {
                        try {
                            let decipher = crypto.createDecipher(config.totp.cipher || 'aes192', config.totp.secret);
                            secret = decipher.update(userData.seed.substr(1), 'hex', 'utf-8');
                            secret += decipher.final('utf8');
                        } catch (E) {
                            log.error('DB', 'TOTPFAIL decipher failed id=%s error=%s', user, E.message);
                            let err = new Error('Can not use decrypted secret');
                            err.code = 'InternalConfigError';
                            return callback(err);
                        }
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
                            action: 'check 2fa totp',
                            result: verified ? 'success' : 'fail',
                            sess: data.sess,
                            ip: data.ip
                        },
                        () => {
                            if (verified) {
                                authSuccess(null, verified);
                            } else {
                                authFail(null, verified);
                            }
                        }
                    );
                }
            );
        });
    }

    enableCustom2fa(user, data, callback) {
        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    enabled2fa: true,
                    username: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to fetch user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    let err = new Error('This username does not exist');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                // previous versions used {enabled2fa: true} for TOTP based 2FA
                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (enabled2fa.includes('custom')) {
                    // 2fa not set up
                    let err = new Error('Custom 2FA is already enabled for this user');
                    err.code = 'CustomEnabled';
                    return callback(err);
                }

                let update =
                    !userData.enabled2fa || typeof userData.enabled2fa === 'boolean'
                        ? {
                              $set: {
                                  enabled2fa: ['custom'].concat(userData.enabled2fa ? 'totp' : [])
                              }
                          }
                        : {
                              $addToSet: {
                                  enabled2fa: 'custom'
                              }
                          };

                // update user settings
                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user
                    },
                    update,
                    {},
                    (err, result) => {
                        if (err) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to update user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!result || !result.value) {
                            let err = new Error('This username does not exist');
                            err.code = 'UserNotFound';
                            return callback(err);
                        }

                        return this.logAuthEvent(
                            user,
                            {
                                action: 'enable 2fa custom',
                                result: 'success',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => callback(null, true)
                        );
                    }
                );
            }
        );
    }

    disableCustom2fa(user, data, callback) {
        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    enabled2fa: true,
                    username: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to update user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    let err = new Error('This username does not exist');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                if (!Array.isArray(userData.enabled2fa) || !userData.enabled2fa.includes('custom')) {
                    let err = new Error('Could not update user, check if custom 2FA is not already disabled');
                    err.code = 'CustomDisabled';
                    return callback(err);
                }

                let update = {
                    $pull: {
                        enabled2fa: 'custom'
                    }
                };

                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user
                    },
                    update,
                    {},
                    (err, result) => {
                        if (err) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to update user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!result || !result.value) {
                            let err = new Error('This username does not exist');
                            err.code = 'UserNotFound';
                            return callback(err);
                        }

                        return this.logAuthEvent(
                            user,
                            {
                                action: 'disable 2fa custom',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => callback(null, true)
                        );
                    }
                );
            }
        );
    }

    setupU2f(user, data, callback) {
        let registrationRequest;
        try {
            registrationRequest = u2f.request(config.u2f.appId);
        } catch (E) {
            log.error('U2F', 'U2FFAIL request id=%s error=%s', user, E.message);
        }

        if (!registrationRequest) {
            return callback(null, false);
        }

        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    username: true,
                    enabled2fa: true,
                    seed: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to check user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (!userData) {
                    err = new Error('Could not find user data');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (enabled2fa.includes('u2f')) {
                    return callback(new Error('U2F 2FA is already enabled for this user'));
                }

                // store registration request to Redis
                this.redis
                    .multi()
                    .set('u2f:req:' + user, JSON.stringify(registrationRequest))
                    .expire('u2f:req:' + user, 1 * 3600)
                    .exec((err, results) => {
                        if ((!err && !results) || !results[0]) {
                            err = new Error('Invalid DB response');
                        } else if (!err && results && results[0] && results[0][0]) {
                            err = results[0][0];
                        }
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        callback(null, registrationRequest);
                    });
            }
        );
    }

    enableU2f(user, data, callback) {
        this.redis
            .multi()
            .get('u2f:req:' + user)
            .del('u2f:req:' + user)
            .exec((err, results) => {
                if ((!err && !results) || !results[0]) {
                    err = new Error('Invalid DB response');
                } else if (!err && results && results[0] && results[0][0]) {
                    err = results[0][0];
                }
                if (err) {
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                let registrationRequest = results[0][1];

                if (!registrationRequest) {
                    let err = new Error('U2F 2FA is not initialized for this user');
                    err.code = 'U2fDisabled';
                    return callback(err);
                }
                try {
                    registrationRequest = JSON.parse(registrationRequest);
                } catch (E) {
                    return callback(new Error('Invalid 2FA data stored'));
                }

                let registrationResponse = {};
                Object.keys(data || {}).forEach(key => {
                    if (['clientData', 'registrationData', 'version', 'challenge'].includes(key)) {
                        registrationResponse[key] = data[key];
                    }
                });

                let result;
                try {
                    result = u2f.checkRegistration(registrationRequest, registrationResponse);
                } catch (E) {
                    log.error('U2F', 'U2FFAIL checkRegistration id=%s error=%s', user, E.message);
                }

                if (!result || !result.successful) {
                    return callback(new Error((result && result.errorMessage) || 'Failed to validate U2F response'));
                }

                this.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        fields: {
                            enabled2fa: true,
                            username: true,
                            u2f: true
                        }
                    },
                    (err, userData) => {
                        if (err) {
                            log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to fetch user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }
                        if (!userData) {
                            let err = new Error('This username does not exist');
                            err.code = 'UserNotFound';
                            return callback(err);
                        }

                        let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                        if (enabled2fa.includes('u2f')) {
                            // 2fa not set up
                            let err = new Error('U2F 2FA is already enabled for this user');
                            err.code = 'U2fEnabled';
                            return callback(err);
                        }

                        let curDate = new Date();
                        let update =
                            !userData.enabled2fa || typeof userData.enabled2fa === 'boolean'
                                ? {
                                      $set: {
                                          enabled2fa: ['u2f'],
                                          u2f: {
                                              keyHandle: result.keyHandle,
                                              pubKey: result.publicKey,
                                              cert: result.certificate,
                                              date: curDate
                                          }
                                      }
                                  }
                                : {
                                      $addToSet: {
                                          enabled2fa: 'u2f'
                                      },
                                      $set: {
                                          u2f: {
                                              keyHandle: result.keyHandle,
                                              pubKey: result.publicKey,
                                              cert: result.certificate,
                                              date: curDate
                                          }
                                      }
                                  };

                        return this.users.collection('users').findOneAndUpdate(
                            {
                                _id: user
                            },
                            update,
                            {},
                            (err, result) => {
                                if (err) {
                                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                                    err.message = 'Database Error, failed to update user';
                                    err.code = 'InternalDatabaseError';
                                    return callback(err);
                                }

                                if (!result || !result.value) {
                                    err = new Error('Failed to set up 2FA. User not found');
                                    err.code = 'UserNotFound';
                                    return callback(err);
                                }

                                return this.logAuthEvent(
                                    user,
                                    {
                                        action: 'enable 2fa u2f',
                                        result: 'success',
                                        sess: data.sess,
                                        ip: data.ip
                                    },
                                    () => callback(null, true)
                                );
                            }
                        );
                    }
                );
            });
    }

    disableU2f(user, data, callback) {
        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    enabled2fa: true,
                    username: true,
                    u2f: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to update user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    let err = new Error('This username does not exist');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (!enabled2fa.includes('u2f')) {
                    return callback(new Error('Could not update user, check if U2F 2FA is not already disabled'));
                }

                let curDate = new Date();
                let update =
                    !userData.enabled2fa || typeof userData.enabled2fa === 'boolean'
                        ? {
                              $set: {
                                  enabled2fa: [],
                                  u2f: {
                                      keyHandle: '',
                                      pubKey: '',
                                      cert: '',
                                      date: curDate
                                  }
                              }
                          }
                        : {
                              $pull: {
                                  enabled2fa: 'u2f'
                              },
                              $set: {
                                  u2f: {
                                      keyHandle: '',
                                      pubKey: '',
                                      cert: '',
                                      date: curDate
                                  }
                              }
                          };

                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user
                    },
                    update,
                    {},
                    (err, result) => {
                        if (err) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to update user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!result || !result.value) {
                            err = new Error('Could not update user, check if 2FA is not already disabled');
                            err.code = 'UserNotFound';
                            return callback(err);
                        }

                        return this.logAuthEvent(
                            user,
                            {
                                action: 'disable 2fa u2f',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => callback(null, true)
                        );
                    }
                );
            }
        );
    }

    startU2f(user, data, callback) {
        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    enabled2fa: true,
                    username: true,
                    u2f: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to find user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    let err = new Error('This user does not exist');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (!enabled2fa.includes('u2f') || !userData.u2f || !userData.u2f.keyHandle) {
                    // 2fa not set up
                    let err = new Error('2FA U2F is not enabled for this user');
                    err.code = 'U2fDisabled';
                    return callback(err);
                }

                this.generateU2fAuthRequest(user, userData.u2f.keyHandle, (err, authRequest) => {
                    if (err) {
                        return callback(err);
                    }
                    if (!authRequest) {
                        return callback(null, false);
                    }
                    callback(null, authRequest);
                });
            }
        );
    }

    checkU2f(user, data, callback) {
        this.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    enabled2fa: true,
                    username: true,
                    u2f: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'LOADFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to find user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    let err = new Error('This user does not exist');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (!enabled2fa.includes('u2f') || !userData.u2f || !userData.u2f.keyHandle) {
                    // 2fa not set up
                    let err = new Error('2FA U2F is not enabled for this user');
                    err.code = 'U2fDisabled';
                    return callback(err);
                }

                this.redis
                    .multi()
                    .get('u2f:auth:' + user)
                    .del('u2f:auth:' + user)
                    .exec((err, results) => {
                        if ((!err && !results) || !results[0]) {
                            err = new Error('Invalid DB response');
                        } else if (!err && results && results[0] && results[0][0]) {
                            err = results[0][0];
                        }
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        let authRequest = results[0][1];

                        if (!authRequest) {
                            return callback(null, false);
                        }
                        try {
                            authRequest = JSON.parse(authRequest);
                        } catch (E) {
                            return callback(null, false);
                        }

                        let authResponse = {};
                        Object.keys(data || {}).forEach(key => {
                            if (['clientData', 'signatureData'].includes(key)) {
                                authResponse[key] = data[key];
                            }
                        });

                        let result;
                        try {
                            result = u2f.checkSignature(authRequest, authResponse, userData.u2f.pubKey);
                        } catch (E) {
                            // ignore
                            log.error('U2F', 'U2FFAIL checkSignature id=%s error=%s', user, E.message);
                        }

                        let verified = result && result.successful;

                        return this.logAuthEvent(
                            user,
                            {
                                action: 'check 2fa u2f',
                                result: verified ? 'success' : 'fail',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => {
                                callback(null, verified);
                            }
                        );
                    });
            }
        );
    }

    disable2fa(user, data, callback) {
        this.users.collection('users').findOneAndUpdate(
            {
                _id: user
            },
            {
                $set: {
                    enabled2fa: [],
                    seed: '',
                    u2f: {
                        keyHandle: '',
                        pubKey: '',
                        cert: '',
                        date: new Date()
                    }
                }
            },
            {},
            (err, result) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to update user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (!result || !result.value) {
                    let err = new Error('Could not update user, check if 2FA is not already disabled');
                    err.code = 'U2fDisabled';
                    return callback(err);
                }

                return this.logAuthEvent(
                    user,
                    {
                        action: 'disable 2fa',
                        sess: data.sess,
                        ip: data.ip
                    },
                    () => callback(null, true)
                );
            }
        );
    }

    update(user, data, callback) {
        let $set = {};
        let updates = false;
        let passwordChanged = false;

        // if some of the counter keys are modified, then reset the according value in Redis
        let resetKeys = new Map([
            ['recipients', 'wdr'],
            ['forwards', 'wdf'],
            ['imapMaxUpload', 'iup'],
            ['imapMaxDownload', 'idw'],
            ['pop3MaxDownload', 'pdw'],
            ['receivedMax', 'rl:rcpt']
        ]);
        let flushKeys = [];

        Object.keys(data).forEach(key => {
            if (['user', 'existingPassword', 'ip'].includes(key)) {
                return;
            }

            if (resetKeys.has(key)) {
                flushKeys.push(resetKeys.get(key) + ':' + user);
            }

            if (key === 'password') {
                if (data[key] === false) {
                    // removes current password (if set)
                    $set.password = '';
                } else {
                    $set.password = data[key]; // hashed below
                }

                $set.tempPassword = false;
                $set.passwordChange = new Date();
                passwordChanged = true;
                return;
            }

            if (key === 'disable2fa') {
                if (data.disable2fa) {
                    $set.enabled2fa = [];
                    $set.seed = '';
                    $set.u2f = {
                        keyHandle: '',
                        pubKey: '',
                        cert: '',
                        date: new Date()
                    };
                }
                updates = true;
                return;
            }

            if (key === 'spamLevel') {
                // spamLevel is from 0 (everything is spam) to 100 (accept everything)
                let spamLevel = !isNaN(data.spamLevel) ? Number(data.spamLevel) : 50;
                if (spamLevel < 0) {
                    spamLevel = 0;
                }
                if (spamLevel > 100) {
                    spamLevel = 100;
                }
                $set.spamLevel = data.spamLevel;
                updates = true;
                return;
            }

            $set[key] = data[key];
            updates = true;
        });

        if ($set.username) {
            $set.unameview = tools.uview($set.username);
        }

        if (!updates && !passwordChanged) {
            return callback(new Error('Nothing was updated'));
        }

        let hashPassword = done => {
            if (!$set.password) {
                return done();
            }
            bcrypt.hash($set.password, consts.BCRYPT_ROUNDS, (err, hash) => {
                if (err) {
                    return done(err);
                }
                $set.password = hash;
                done();
            });
        };

        hashPassword(err => {
            if (err) {
                log.error('DB', 'HASHFAIL user.update id=%s error=%s', data.username, err.message);
                err.code = 'BcryptError';
                return callback(err);
            }

            let verifyExistingPassword = next => {
                this.users.collection('users').findOne({ _id: user }, { fields: { password: true, oldPasswords: true } }, (err, userData) => {
                    if (err) {
                        log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                        err.message = 'Database Error, failed to find user';
                        err.code = 'InternalDatabaseError';
                        return callback(err);
                    }

                    if (!userData) {
                        log.error('DB', 'UPDATEFAIL id=%s error=%s', user, 'User was not found');
                        err = new Error('User was not found');
                        err.code = 'UserNotFound';
                        return callback(err);
                    }

                    // push current password to old passwords list on password change (and not temporary password)
                    if ($set.password && userData && userData.password) {
                        let oldPasswords = [].concat(userData.oldPasswords || []);
                        oldPasswords.push({
                            date: new Date(),
                            hash: userData.password
                        });
                        $set.oldPasswords = oldPasswords;
                    }

                    if (!data.existingPassword) {
                        return next();
                    }

                    if (!userData.password) {
                        return next();
                    }

                    bcrypt.compare(data.existingPassword, userData.password, (err, success) => {
                        if (err) {
                            log.error('DB', 'HASHFAIL user.update id=%s error=%s', data.username, err.message);
                            err.code = err.code || 'BcryptError';
                            return callback(err);
                        }

                        if (success) {
                            return next();
                        }

                        return this.logAuthEvent(
                            user,
                            {
                                action: 'password change',
                                result: 'fail',
                                sess: data.sess,
                                ip: data.ip
                            },
                            () => callback(new Error('Password verification failed'))
                        );
                    });
                });
            };

            verifyExistingPassword(() => {
                this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user
                    },
                    {
                        $set
                    },
                    {
                        returnOriginal: false
                    },
                    (err, result) => {
                        if (err) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                            err.message = 'Database Error, failed to update user';
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!result || !result.value) {
                            log.error('DB', 'UPDATEFAIL id=%s error=%s', user, 'User was not found');
                            err = new Error('user was not found');
                            err.code = 'UserNotFound';
                            return callback(err);
                        }

                        // check if we need to reset any ttl counters
                        if (flushKeys.length) {
                            let flushreq = this.redis.multi();
                            flushKeys.forEach(key => {
                                flushreq = flushreq.del(key);
                            });
                            // just call the operations and hope for the best, no problems if fails
                            flushreq.exec(() => false);
                        }

                        this.userCache.flush(user, () => false);

                        if (passwordChanged) {
                            return this.logAuthEvent(
                                user,
                                {
                                    action: 'password change',
                                    result: 'success',
                                    sess: data.sess,
                                    ip: data.ip
                                },
                                () => callback(null, true)
                            );
                        } else {
                            return callback(null, true);
                        }
                    }
                );
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
            }
        ];

        let uidValidity = Math.floor(Date.now() / 1000);

        return defaultMailboxes.map(mailbox => ({
            path: mailbox.path === 'INBOX' ? 'INBOX' : translation[mailbox.specialUse || mailbox.path] || mailbox.path,
            specialUse: mailbox.specialUse,
            uidValidity,
            uidNext: 1,
            modifyIndex: 0,
            subscribed: true,
            flags: []
        }));
    }

    logAuthEvent(user, entry, callback) {
        if (this.authlogExpireDays === false) {
            return callback();
        }

        if (user) {
            entry.user = user;
        } else {
            entry.user = entry.user || new ObjectID('000000000000000000000000');
        }

        entry.action = entry.action || 'authentication';
        entry.created = new Date();

        if (typeof this.authlogExpireDays === 'number' && this.authlogExpireDays !== 0) {
            entry.expires = new Date(Date.now() + Math.abs(this.authlogExpireDays) * 24 * 3600 * 1000);
        }

        return this.users.collection('authlog').insertOne(entry, callback);
    }

    logout(user, reason, callback) {
        // register this address as the default address for that user
        return this.users.collection('users').findOne(
            {
                _id: new ObjectID(user)
            },
            {
                fields: {
                    _id: true
                }
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'DBFAIL logout id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to find user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                if (!userData) {
                    err = new Error('User not found');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                if (!this.messageHandler || !this.messageHandler.notifier) {
                    return callback(null, false);
                }

                this.messageHandler.notifier.fire(userData._id, {
                    command: 'LOGOUT',
                    reason
                });
                return callback(null, true);
            }
        );
    }

    // This method deletes non expireing records from database
    delete(user, meta, callback) {
        meta = meta || {};

        // clear limits in Redis
        this.redis.del('limits:' + user, () => false);

        this.database.collection('messages').updateMany(
            { user },
            {
                $set: {
                    exp: true,
                    rdate: new Date(Date.now() + 2 * 24 * 3600 * 1000),
                    userDeleted: true
                }
            },
            err => {
                if (err) {
                    log.error('USERDEL', 'Failed to delete messages for id=%s error=%s', user, err.message);
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                let tryCount = 0;
                let tryDelete = err => {
                    if (tryCount++ > 10) {
                        return callback(err);
                    }

                    this.database.collection('mailboxes').deleteMany({ user }, err => {
                        if (err) {
                            log.error('USERDEL', 'Failed to delete mailboxes for id=%s error=%s', user, err.message);
                            err.code = 'InternalDatabaseError';
                            if (tryCount > 2) {
                                return setTimeout(() => tryDelete(err), 100);
                            }
                        }

                        this.users.collection('addresses').deleteMany({ user }, err => {
                            if (err) {
                                log.error('USERDEL', 'Failed to delete addresses for id=%s error=%s', user, err.message);
                                err.code = 'InternalDatabaseError';
                                if (tryCount > 4) {
                                    return setTimeout(() => tryDelete(err), 100);
                                }
                            }

                            this.users.collection('users').deleteOne({ _id: user }, err => {
                                if (err) {
                                    log.error('USERDEL', 'Failed to delete user id=%s error=%s', user, err.message);
                                    err.code = 'InternalDatabaseError';
                                    return setTimeout(() => tryDelete(err), 100);
                                }

                                this.users.collection('asps').deleteMany({ user }, err => {
                                    if (err) {
                                        log.error('USERDEL', 'Failed to delete asps for id=%s error=%s', user, err.message);
                                        err.code = 'InternalDatabaseError';
                                    }

                                    this.users.collection('filters').deleteMany({ user }, err => {
                                        if (err) {
                                            log.error('USERDEL', 'Failed to delete filters for id=%s error=%s', user, err.message);
                                            err.code = 'InternalDatabaseError';
                                        }

                                        this.users.collection('autoreplies').deleteMany({ user }, err => {
                                            if (err) {
                                                log.error('USERDEL', 'Failed to delete autoreplies for id=%s error=%s', user, err.message);
                                                err.code = 'InternalDatabaseError';
                                            }

                                            return this.logAuthEvent(
                                                user,
                                                {
                                                    action: 'delete user',
                                                    result: 'success',
                                                    sess: meta.session,
                                                    ip: meta.ip
                                                },
                                                () => callback(null, true)
                                            );
                                        });
                                    });
                                });
                            });
                        });
                    });
                };
                setImmediate(tryDelete);
            }
        );
    }

    checkAddress(username, callback) {
        if (username.indexOf('@') < 0) {
            // assume regular username
            return callback(null, {
                unameview: tools.uview(username)
            });
        }

        // try to find existing email address
        // we do not use resolveAddress because it is too lax
        let address = tools.normalizeAddress(username, { removeLabel: true });
        this.users.collection('addresses').findOne(
            {
                addrview: tools.normalizeAddress(address, false, { removeDots: true })
            },
            {
                fields: {
                    user: true
                }
            },
            (err, addressData) => {
                if (err) {
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (!addressData || !addressData.user) {
                    // fall back to username formatted as an address
                    return callback(null, {
                        unameview: tools.normalizeAddress(address, false, { removeDots: true })
                    });
                }

                callback(null, {
                    _id: addressData.user
                });
            }
        );
    }
}

function rateLimitResponse(res, callback) {
    let err = new Error('Authentication was rate limited. Check again in ' + res.ttl + ' seconds');
    err.response = 'NO';
    err.code = 'RateLimitedError';
    return callback(err);
}

// high collision hash function
function getStringSelector(str) {
    let hash = crypto
        .createHash('sha1')
        .update(str)
        .digest();
    let sum = 0;
    for (let i = 0, len = hash.length; i < len; i++) {
        sum += hash[i];
    }
    return (sum % 32).toString(16);
}

module.exports = UserHandler;
