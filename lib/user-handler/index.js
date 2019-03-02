'use strict';

const config = require('wild-config');
const log = require('npmlog');
const hashes = require('./hashes');
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
const MailComposer = require('nodemailer/lib/mail-composer');
const humanname = require('humanname');
const u2f = require('u2f');
const UserCache = require('./user-cache');
const isemail = require('isemail');

const TOTP_SETUP_TTL = 6 * 3600 * 1000;

class UserHandler {
    constructor(options) {
        this.database = options.database;
        this.users = options.users || options.database;
        this.redis = options.redis;

        this.loggelf = options.loggelf || (() => false);

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

        address = tools.normalizeAddress(address, false, {
            removeLabel: true,
            removeDots: true
        });

        let username = address.substr(0, address.indexOf('@'));
        let domain = address.substr(address.indexOf('@') + 1);

        let projection = {
            user: true,
            targets: true
        };

        Object.keys(options.projection || {}).forEach(key => {
            projection[key] = true;
        });

        // try exact match
        this.users.collection('addresses').findOne(
            {
                addrview: username + '@' + domain
            },
            {
                projection,
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                    this.users.collection('domainaliases').findOne(
                        { alias: domain },
                        {
                            maxTimeMS: consts.DB_MAX_TIME_USERS
                        },
                        (err, aliasData) => {
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
                                    projection,
                                    maxTimeMS: consts.DB_MAX_TIME_USERS
                                },
                                done
                            );
                        }
                    );
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
                            projection,
                            maxTimeMS: consts.DB_MAX_TIME_USERS
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
                                    projection,
                                    maxTimeMS: consts.DB_MAX_TIME_USERS
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

            this.resolveAddress(username, { projection: { name: true } }, (err, addressData) => {
                if (err) {
                    return callback(err);
                }
                if (addressData.user) {
                    return next(null, {
                        query: { _id: addressData.user },
                        addressData
                    });
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
                    projection: fields,
                    maxTimeMS: consts.DB_MAX_TIME_USERS
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
        if (!meta || !meta.ip || !consts.IP_AUTH_FAILURES) {
            return callback(null, { success: true });
        }
        let wlKey = 'rl-wl';
        // $ redis-cli
        // > SADD "rl-wl" "1.2.3.4"
        this.redis.sismember(wlKey, meta.ip, (err, isMember) => {
            if (err) {
                log.error('Redis', 'SMFAIL key=%s value=%s error=%s', wlKey, meta.ip, err.message);
                // ignore errors
                return callback(null, { success: true });
            }

            if (isMember) {
                // whitelisted IP
                return callback(null, { success: true });
            }

            return this.counters.ttlcounter('auth_ip:' + meta.ip, count, consts.IP_AUTH_FAILURES, consts.IP_AUTH_WINDOW, callback);
        });
    }

    /**
     * rateLimitUser
     * @param  {String}   tokenID  user identifier
     * @param  {Integer}  count
     * @param  {Function} callback
     */
    rateLimitUser(tokenID, meta, count, callback) {
        let checkUserRateLimit = () => this.counters.ttlcounter('auth_user:' + tokenID, count, consts.USER_AUTH_FAILURES, consts.USER_AUTH_WINDOW, callback);

        if (!meta || !meta.ip) {
            // not IP address to check for
            return checkUserRateLimit();
        }

        let wlKey = 'rl-wl';
        // $ redis-cli
        // > SADD "rl-wl" "1.2.3.4"
        this.redis.sismember(wlKey, meta.ip, (err, isMember) => {
            if (err) {
                log.error('Redis', 'SMFAIL key=%s value=%s error=%s', wlKey, meta.ip, err.message);
                // ignore errors
            }

            if (isMember) {
                // whitelisted IP, allow authentication attempt without rate limits
                return callback(null, { success: true });
            }

            return checkUserRateLimit();
        });
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

            this.rateLimitUser(tokenID, meta, count, (err, userRes) => {
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

        username = (username || '').toString();
        let userDomain = username.indexOf('@') >= 0 ? username.split('@').pop() : '';

        let passwordType = 'master';
        let passwordId;

        meta = meta || {};
        meta.requiredScope = requiredScope;

        if (!password) {
            // do not allow signing in without a password
            this.loggelf({
                short_message: '[AUTHFAIL] ' + username,
                _error: 'Empty password',
                _auth_result: 'fail',
                _username: username,
                _domain: userDomain,
                _scope: requiredScope,
                _ip: meta.ip
            });
            return callback(null, false, false);
        }

        // first check if client IP is not used too much
        this.rateLimitIP(meta, 0, (err, res) => {
            if (err) {
                err.code = 'InternalDatabaseError';
                this.loggelf({
                    short_message: '[AUTHFAIL] ' + username,
                    full_message: err.stack,
                    _error: err.message,
                    _code: err.code,
                    _auth_result: 'error',
                    _username: username,
                    _domain: userDomain,
                    _scope: requiredScope,
                    _ip: meta.ip
                });
                return callback(err, false, false);
            }

            if (!res.success) {
                // too many failed attempts from this IP
                this.loggelf({
                    short_message: '[AUTHFAIL] ' + username,
                    _error: 'Rate limited',
                    _auth_result: 'ratelimited',
                    _username: username,
                    _domain: userDomain,
                    _scope: requiredScope,
                    _ip: meta.ip
                });
                return rateLimitResponse(res, err => callback(err, false, false));
            }

            this.checkAddress(username, (err, query) => {
                if (err) {
                    this.loggelf({
                        short_message: '[AUTHFAIL] ' + username,
                        _error: 'Unknown user',
                        _auth_result: 'unknown',
                        _username: username,
                        _domain: userDomain,
                        _scope: requiredScope,
                        _ip: meta.ip
                    });
                    return callback(err, false, false);
                }

                if (!query) {
                    // nothing to do here
                    return callback(null, false, false);
                }

                this.users.collection('users').findOne(
                    query,
                    {
                        projection: {
                            _id: true,
                            username: true,
                            address: true,
                            tempPassword: true,
                            password: true,
                            enabled2fa: true,
                            u2f: true,
                            disabled: true,
                            disabledScopes: true
                        },
                        maxTimeMS: consts.DB_MAX_TIME_USERS
                    },
                    (err, userData) => {
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            this.loggelf({
                                short_message: '[AUTHFAIL] ' + username,
                                full_message: err.stack,
                                _error: err.message,
                                _code: err.code,
                                _auth_result: 'error',
                                _username: username,
                                _domain: userDomain,
                                _scope: requiredScope,
                                _ip: meta.ip
                            });
                            return callback(err, false, false);
                        }

                        if (!userData) {
                            // rate limit failed authentication attempts against non-existent users as well
                            let ustring = (query.unameview || query._id || '').toString();
                            return this.rateLimit(ustring, meta, 1, (err, res) => {
                                if (err) {
                                    err.code = 'InternalDatabaseError';
                                    this.loggelf({
                                        short_message: '[AUTHFAIL] ' + username,
                                        full_message: err.stack,
                                        _error: err.message,
                                        _code: err.code,
                                        _auth_result: 'error',
                                        _username: username,
                                        _domain: userDomain,
                                        _scope: requiredScope,
                                        _ip: meta.ip
                                    });
                                    return callback(err, false, false);
                                }
                                if (!res.success) {
                                    // does not really matter but respond with a rate limit error, not auth fail error
                                    this.loggelf({
                                        short_message: '[AUTHFAIL] ' + username,
                                        _error: 'Rate limited',
                                        _auth_result: 'ratelimited',
                                        _username: username,
                                        _domain: userDomain,
                                        _scope: requiredScope,
                                        _ip: meta.ip
                                    });
                                    return rateLimitResponse(res, err => callback(err, false, false));
                                }

                                this.loggelf({
                                    short_message: '[AUTHFAIL] ' + username,
                                    _error: 'Unknown user',
                                    _auth_result: 'unknown',
                                    _username: username,
                                    _domain: userDomain,
                                    _scope: requiredScope,
                                    _ip: meta.ip
                                });
                                callback(null, false, false);
                            });
                        }

                        // make sure we use the primary domain if available
                        userDomain = (userData.address || '').split('@').pop() || userDomain;

                        // check if there are not too many auth attempts for that user
                        this.rateLimitUser(userData._id, meta, 0, (err, res) => {
                            if (err) {
                                err.code = 'InternalDatabaseError';
                                this.loggelf({
                                    short_message: '[AUTHFAIL] ' + username,
                                    full_message: err.stack,
                                    _error: err.message,
                                    _code: err.code,
                                    _auth_result: 'error',
                                    _username: username,
                                    _domain: userDomain,
                                    _user: userData._id,
                                    _scope: requiredScope,
                                    _ip: meta.ip
                                });
                                return callback(err, false, userData._id);
                            }
                            if (!res.success) {
                                // too many failed attempts for this user
                                this.loggelf({
                                    short_message: '[AUTHFAIL] ' + username,
                                    _error: 'Rate limited',
                                    _auth_result: 'ratelimited',
                                    _username: username,
                                    _domain: userDomain,
                                    _user: userData._id,
                                    _scope: requiredScope,
                                    _ip: meta.ip
                                });
                                return rateLimitResponse(res, err => callback(err, false, userData._id));
                            }

                            if (userData.disabled) {
                                // disabled users can not log in
                                meta.result = 'disabled';
                                // TODO: should we send some specific error message?
                                this.loggelf({
                                    short_message: '[AUTHFAIL] ' + username,
                                    _error: 'User is disabled',
                                    _auth_result: 'disabled',
                                    _username: username,
                                    _domain: userDomain,
                                    _user: userData._id,
                                    _scope: requiredScope,
                                    _ip: meta.ip
                                });
                                return this.logAuthEvent(userData._id, meta, () => callback(null, false, userData._id));
                            }

                            let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                            let getU2fAuthRequest = done => {
                                if (!enabled2fa.includes('u2f') || !userData.u2f || !userData.u2f.keyHandle) {
                                    return done(null, false);
                                }
                                this.generateU2fAuthRequest(userData._id, userData.u2f.keyHandle, meta.appId, done);
                            };

                            let authSuccess = (...args) => {
                                // clear rate limit counter on success
                                this.rateLimitReleaseUser(userData._id, () => false);

                                this.loggelf({
                                    short_message: '[AUTHOK] ' + username,
                                    _auth_result: 'success',
                                    _username: username,
                                    _domain: userDomain,
                                    _user: userData._id,
                                    _password_type: passwordType,
                                    _password_id: passwordId,
                                    _scope: requiredScope,
                                    _ip: meta.ip
                                });
                                callback(...args);
                            };

                            let authFail = (...args) => {
                                let err = args[0] || {};
                                this.loggelf({
                                    short_message: '[AUTHFAIL] ' + username,
                                    full_message: err.stack,
                                    _error: err.message || 'Authentication failed',
                                    _code: err.code,
                                    _auth_result: 'fail',
                                    _username: username,
                                    _domain: userDomain,
                                    _user: userData._id,
                                    _password_type: passwordType,
                                    _password_id: passwordId,
                                    _scope: requiredScope,
                                    _ip: meta.ip
                                });

                                // increment rate limit counter on failure
                                this.rateLimit(userData._id, meta, 1, () => {
                                    callback(...args);
                                });
                            };

                            let requirePasswordChange = false;
                            let usingTemporaryPassword = false;

                            let checkMasterPassword = next => {
                                let checkAccountPassword = () => {
                                    hashes.compare(password, userData.password, (err, success) => {
                                        if (err) {
                                            return next(err);
                                        }

                                        if (!success) {
                                            return next(null, success);
                                        }

                                        if (hashes.shouldRehash(userData.password)) {
                                            // needs rehashing

                                            return hashes.hash(password, (err, hash) => {
                                                if (err) {
                                                    log.error('DB', 'HASHFAIL rehash user=%s error=%s', userData._id, err.message);
                                                    // ignore DB error, rehash some other time
                                                    return next(null, success);
                                                }
                                                if (!hash) {
                                                    // should this happen???
                                                    return next(null, success);
                                                }

                                                return this.users.collection('users').updateOne(
                                                    {
                                                        _id: userData._id
                                                    },
                                                    {
                                                        $set: {
                                                            password: hash
                                                        }
                                                    },
                                                    { w: 'majority' },
                                                    err => {
                                                        if (err) {
                                                            log.error('DB', 'DBFAIL rehash user=%s error=%s', userData._id, err.message);
                                                        } else {
                                                            log.info('DB', 'REHASHED user=%s algo=%s', userData._id, consts.DEFAULT_HASH_ALGO);
                                                        }

                                                        // ignore DB error, rehash some other time
                                                        return next(null, success);
                                                    }
                                                );
                                            });
                                        }

                                        next(null, success);
                                    });
                                };

                                if (userData.tempPassword && userData.tempPassword.created > new Date(Date.now() - consts.TEMP_PASS_WINDOW)) {
                                    // try temporary password
                                    return hashes.compare(password, userData.tempPassword.password, (err, success) => {
                                        if (err) {
                                            err.code = 'HashError';
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
                                    return authFail(err, false, userData._id);
                                }

                                if (success) {
                                    meta.result = 'success';
                                    meta.source = !usingTemporaryPassword ? 'master' : 'temporary';

                                    if (enabled2fa.length) {
                                        meta.require2fa = enabled2fa.length ? enabled2fa.join(',') : false;
                                    }

                                    let disabledScopes = userData.disabledScopes || [];

                                    if (requiredScope !== 'master' && (enabled2fa.length || usingTemporaryPassword || disabledScopes.includes(requiredScope))) {
                                        // master password can not be used for other stuff if 2FA is enabled
                                        // temporary password is only valid for master
                                        meta.result = 'fail';
                                        let err = new Error('Authentication failed. Invalid scope');
                                        err.code = 'InvalidAuthScope';
                                        err.response = 'NO'; // imap response code
                                        return this.logAuthEvent(userData._id, meta, () => authFail(err, false, userData._id));
                                    }

                                    return this.logAuthEvent(userData._id, meta, (err, authEvent) => {
                                        if (err) {
                                            // should not happen
                                        }

                                        if (authEvent) {
                                            this.users.collection('users').updateOne(
                                                {
                                                    _id: userData._id
                                                },
                                                {
                                                    $set: {
                                                        lastLogin: {
                                                            time: new Date(),
                                                            authEvent,
                                                            ip: meta.ip
                                                        }
                                                    }
                                                },
                                                {
                                                    maxTimeMS: consts.DB_MAX_TIME_USERS
                                                },
                                                () => false
                                            );
                                        }

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
                                                authSuccess(null, authResponse, userData._id);
                                            });
                                        }

                                        authSuccess(null, authResponse, userData._id);
                                    });
                                }

                                if (requiredScope === 'master') {
                                    // only master password can be used for management tasks
                                    meta.result = 'fail';
                                    meta.source = 'master';
                                    return this.logAuthEvent(userData._id, meta, () => authFail(null, false, userData._id));
                                }

                                // try application specific passwords
                                password = password.replace(/\s+/g, '').toLowerCase();

                                if (!/^[a-z]{16}$/.test(password)) {
                                    // does not look like an application specific password
                                    meta.result = 'fail';
                                    meta.source = 'master';
                                    return this.logAuthEvent(userData._id, meta, () => authFail(null, false, userData._id));
                                }

                                let selector = getStringSelector(password);

                                this.users
                                    .collection('asps')
                                    .find({
                                        user: userData._id
                                    })
                                    .maxTimeMS(consts.DB_MAX_TIME_USERS)
                                    .toArray((err, asps) => {
                                        if (err) {
                                            err.code = 'InternalDatabaseError';
                                            return authFail(err, false, userData._id);
                                        }

                                        if (!asps || !asps.length) {
                                            // user does not have app specific passwords set
                                            meta.result = 'fail';
                                            meta.source = 'master';
                                            return this.logAuthEvent(userData._id, meta, () => authFail(null, false, userData._id));
                                        }

                                        let pos = 0;
                                        let checkNext = () => {
                                            if (pos >= asps.length) {
                                                meta.result = 'fail';
                                                meta.source = 'master';
                                                return this.logAuthEvent(userData._id, meta, () => authFail(null, false, userData._id));
                                            }

                                            let asp = asps[pos++];
                                            if (asp.selector && asp.selector !== selector) {
                                                // no need to check, definitely a wrong one
                                                return setImmediate(checkNext);
                                            }

                                            hashes.compare(password, asp.password, (err, success) => {
                                                if (err) {
                                                    err.code = 'HashError';
                                                    return authFail(err, false, userData._id);
                                                }

                                                if (!success) {
                                                    return setImmediate(checkNext);
                                                }

                                                meta.source = 'asp';
                                                meta.asp = asp._id;
                                                // store ASP name in case the ASP gets deleted and for faster listing
                                                meta.aname = asp.description;

                                                passwordType = 'asp';
                                                passwordId = asp._id.toString();

                                                if (!asp.scopes.includes('*') && !asp.scopes.includes(requiredScope)) {
                                                    meta.result = 'fail';
                                                    return this.logAuthEvent(userData._id, meta, () => {
                                                        let err = new Error('Authentication failed. Invalid scope');
                                                        err.code = 'InvalidAuthScope';
                                                        err.response = 'NO'; // imap response code
                                                        authFail(err, false, userData._id);
                                                    });
                                                }

                                                meta.result = 'success';

                                                this.logAuthEvent(userData._id, meta, (err, authEvent) => {
                                                    if (err) {
                                                        // don't really care
                                                    }
                                                    let aspUpdates = {
                                                        used: new Date(),
                                                        authEvent,
                                                        authIp: meta.ip
                                                    };

                                                    if (asp.ttl) {
                                                        // extend temporary password ttl every time it is used
                                                        aspUpdates.expires = new Date(Date.now() + asp.ttl * 1000);
                                                    }

                                                    this.users.collection('asps').findOneAndUpdate(
                                                        {
                                                            _id: asp._id
                                                        },
                                                        {
                                                            $set: aspUpdates
                                                        },
                                                        {
                                                            maxTimeMS: consts.DB_MAX_TIME_USERS
                                                        },
                                                        () => {
                                                            authSuccess(
                                                                null,
                                                                {
                                                                    user: userData._id,
                                                                    username: userData.username,
                                                                    scope: requiredScope,
                                                                    asp: asp._id.toString(),
                                                                    require2fa: false // application scope never requires 2FA
                                                                },
                                                                userData._id
                                                            );
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
                    projection: {
                        _id: true,
                        username: true,
                        oldPasswords: true,
                        disabled: true
                    },
                    maxTimeMS: consts.DB_MAX_TIME_USERS
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

                            hashes.compare(password, oldPassword.hash, (err, success) => {
                                if (err) {
                                    err.code = 'HashError';
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

    generateU2fAuthRequest(user, keyHandle, appId, callback) {
        let authRequest;
        try {
            authRequest = u2f.request(appId || config.u2f.appId, keyHandle);
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
            } else if (allowedScopes.includes(scope)) {
                scopeSet.add(scope);
            }
        });

        if (hasAllScopes || scopeSet.size === allowedScopes.length) {
            scopes = ['*'];
        } else {
            scopes = Array.from(scopeSet).sort((a, b) => a.localeCompare(b));
        }

        hashes.hash(password, (err, hash) => {
            if (err) {
                log.error('DB', 'HASHFAIL generateASP id=%s error=%s', user, err.message);
                err.code = 'HashError';
                return callback(err);
            }

            let passwordData = {
                _id: new ObjectID(),
                user,
                description: data.description,
                scopes,
                password: hash,
                selector,
                used: false,
                authEvent: false,
                authIp: false,
                created: new Date()
            };

            if (data.ttl) {
                passwordData.ttl = data.ttl;
                passwordData.expires = new Date(Date.now() + data.ttl * 1000);
            }

            // register this address as the default address for that user
            return this.users.collection('users').findOne(
                {
                    _id: user
                },
                {
                    projection: {
                        _id: true
                    },
                    maxTimeMS: consts.DB_MAX_TIME_USERS
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
                                temporary: passwordData.ttl ? true : false,
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
            {
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                projection: {
                    unameview: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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

                let allowedScopes = [...consts.SCOPES];
                let scopeSet = new Set();
                let disabledScopes = [].concat(data.disabledScopes || []);
                disabledScopes.forEach(scope => {
                    scope = scope.toLowerCase().trim();
                    if (allowedScopes.includes(scope)) {
                        scopeSet.add(scope);
                    }
                });
                disabledScopes = Array.from(scopeSet).sort((a, b) => a.localeCompare(b));

                let checkAddress = done => {
                    if (data.emptyAddress) {
                        return done();
                    }

                    this.users.collection('addresses').findOne(
                        {
                            addrview
                        },
                        {
                            projection: {
                                _id: true
                            },
                            maxTimeMS: consts.DB_MAX_TIME_USERS
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
                            return done(null, '');
                        }

                        if (data.hashedPassword) {
                            // try if the bcrypt library can handle it?
                            return hashes.compare('whatever', data.password, err => {
                                if (err) {
                                    return done(err);
                                }
                                // did not throw, so probably OK
                                return done(null, data.password);
                            });
                        }

                        hashes.hash(data.password, done);
                    };

                    hashPassword((err, hash) => {
                        if (err) {
                            log.error('DB', 'HASHFAIL user.create id=%s error=%s', data.username, err.message);
                            err.code = 'HashError';
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
                            pendingSeed: '',
                            pendingSeedChanged: false,

                            // default email address
                            address: '', // set this later

                            language: data.language,

                            // quota
                            storageUsed: 0,
                            quota: data.quota || 0,

                            recipients: data.recipients || 0,
                            forwards: data.forwards || 0,

                            imapMaxUpload: data.imapMaxUpload || 0,
                            imapMaxDownload: data.imapMaxDownload || 0,
                            pop3MaxDownload: data.pop3MaxDownload || 0,
                            imapMaxConnections: data.imapMaxConnections || 0,

                            receivedMax: data.receivedMax || 0,

                            targets: [].concat(data.targets || []),

                            // autoreply status
                            // off by default, can be changed later by user through the API
                            autoreply: false,

                            uploadSentMessages: !!data.uploadSentMessages,
                            pubKey: data.pubKey || '',
                            encryptMessages: !!data.encryptMessages,
                            encryptForwarded: !!data.encryptForwarded,

                            spamLevel,

                            // default retention for user mailboxes
                            retention: data.retention || 0,

                            disabledScopes,

                            lastLogin: {
                                time: false,
                                authEvent: false,
                                ip: false
                            },

                            metaData: data.metaData || '',

                            // until setup value is not true, this account is not usable
                            activated: false,
                            disabled: true,

                            created: new Date()
                        };

                        if (data.tags && data.tags.length) {
                            userData.tags = data.tags;
                            userData.tagsview = data.tagsview;
                        }

                        this.users.collection('users').insertOne(userData, { w: 'majority' }, err => {
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

                            let mailboxes = this.getMailboxes(data.language, data.mailboxes).map(mailbox => {
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
                                    w: 'majority',
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
                                        this.users.collection('addresses').insertOne(addressData, { w: 'majority' }, err => {
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
                                            {
                                                returnOriginal: false,
                                                maxTimeMS: consts.DB_MAX_TIME_USERS
                                            },
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

        hashes.hash(password, (err, hash) => {
            if (err) {
                log.error('DB', 'HASHFAIL user.reset id=%s error=%s', user, err.message);
                err.code = 'HashError';
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
                {
                    maxTimeMS: consts.DB_MAX_TIME_USERS
                },
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
                projection: {
                    username: true,
                    enabled2fa: true,
                    seed: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
            (err, userData) => {
                if (err) {
                    log.error('DB', 'UPDATEFAIL id=%s error=%s', user, err.message);
                    err.message = 'Database Error, failed to check user';
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (!userData) {
                    let err = new Error('Could not find user data');
                    err.code = 'UserNotFound';
                    return callback(err);
                }

                let enabled2fa = Array.isArray(userData.enabled2fa) ? userData.enabled2fa : [].concat(userData.enabled2fa ? 'totp' : []);

                if (enabled2fa.includes('totp')) {
                    let err = new Error('TOTP 2FA is already enabled for this user');
                    err.code = 'TotpEnabled';
                    return callback(err);
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
                            pendingSeed: seed,
                            pendingSeedChanged: new Date()
                        }
                    },
                    { maxTimeMS: consts.DB_MAX_TIME_USERS },
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

                        QRCode.toDataURL(otpauth_url, (err, dataUrl) => {
                            if (err) {
                                log.error('DB', 'QRFAIL id=%s error=%s', user, err.message);
                                err.message = 'Failed to generate QR code';
                                err.code = 'QRError';
                                return callback(err);
                            }

                            callback(null, {
                                secret: secret.base32,
                                dataUrl
                            });
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
                projection: {
                    enabled2fa: true,
                    username: true,
                    pendingSeed: true,
                    pendingSeedChanged: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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

                if (enabled2fa.includes('totp')) {
                    // 2fa not set up
                    let err = new Error('TOTP 2FA is already enabled for this user');
                    err.code = 'TotpEnabled';
                    return callback(err);
                }

                if (!userData.pendingSeed || (userData.pendingSeedChanged && userData.pendingSeedChanged < new Date(Date.now() - TOTP_SETUP_TTL))) {
                    // 2fa not set up
                    let err = new Error('TOTP 2FA is not initialized for this user');
                    err.code = 'TotpDisabled';
                    return callback(err);
                }

                let secret = userData.pendingSeed;
                if (secret.charAt(0) === '$' && config.totp && config.totp.secret) {
                    try {
                        let decipher = crypto.createDecipher(config.totp.cipher || 'aes192', config.totp.secret);
                        secret = decipher.update(secret.substr(1), 'hex', 'utf-8');
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
                                  seed: userData.pendingSeed,
                                  pendingSeed: '',
                                  pendingSeedChanged: false,
                                  enabled2fa: ['totp']
                              }
                          }
                        : {
                              $set: {
                                  seed: userData.pendingSeed,
                                  pendingSeed: '',
                                  pendingSeedChanged: false
                              },
                              $addToSet: {
                                  enabled2fa: 'totp'
                              }
                          };

                // token was valid, update user settings
                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user,
                        pendingSeed: userData.pendingSeed
                    },
                    update,
                    { maxTimeMS: consts.DB_MAX_TIME_USERS },
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
                projection: {
                    enabled2fa: true,
                    username: true,
                    seed: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                                  seed: '',
                                  pendingSeed: '',
                                  pendingSeedChanged: false
                              }
                          }
                        : {
                              $pull: {
                                  enabled2fa: 'totp'
                              },
                              $set: {
                                  seed: '',
                                  pendingSeed: '',
                                  pendingSeedChanged: false
                              }
                          };

                return this.users.collection('users').findOneAndUpdate(
                    {
                        _id: user
                    },
                    update,
                    { maxTimeMS: consts.DB_MAX_TIME_USERS },
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
                    projection: {
                        username: true,
                        enabled2fa: true,
                        seed: true
                    },
                    maxTimeMS: consts.DB_MAX_TIME_USERS
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
                projection: {
                    enabled2fa: true,
                    username: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                    { maxTimeMS: consts.DB_MAX_TIME_USERS },
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
                projection: {
                    enabled2fa: true,
                    username: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                    {
                        maxTimeMS: consts.DB_MAX_TIME_USERS
                    },
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
            registrationRequest = u2f.request(data.appId || config.u2f.appId);
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
                projection: {
                    username: true,
                    enabled2fa: true,
                    seed: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                        projection: {
                            enabled2fa: true,
                            username: true,
                            u2f: true
                        },
                        maxTimeMS: consts.DB_MAX_TIME_USERS
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
                            { maxTimeMS: consts.DB_MAX_TIME_USERS },
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
                projection: {
                    enabled2fa: true,
                    username: true,
                    u2f: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                    {
                        maxTimeMS: consts.DB_MAX_TIME_USERS
                    },
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
                projection: {
                    enabled2fa: true,
                    username: true,
                    u2f: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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

                this.generateU2fAuthRequest(user, userData.u2f.keyHandle, data.appId, (err, authRequest) => {
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
                projection: {
                    enabled2fa: true,
                    username: true,
                    u2f: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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
                    pendingSeed: '',
                    pendingSeedChanged: false,
                    u2f: {
                        keyHandle: '',
                        pubKey: '',
                        cert: '',
                        date: new Date()
                    }
                }
            },
            {
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
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
        let flushHKeys = [];

        Object.keys(data).forEach(key => {
            if (['user', 'existingPassword', 'hashedPassword', 'allowUnsafe', 'ip', 'sess'].includes(key)) {
                return;
            }

            if (resetKeys.has(key)) {
                flushKeys.push(resetKeys.get(key) + ':' + user);
            }
            if (key === 'imapMaxConnections') {
                flushHKeys.push({ key: 'lim:imap', value: user.toString() });
            }

            if (key === 'password') {
                if (!data[key]) {
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
                    $set.pendingSeed = '';
                    $set.pendingSeedChanged = false;
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

            if (key === 'disabledScopes') {
                let allowedScopes = [...consts.SCOPES];
                let scopeSet = new Set();
                let disabledScopes = [].concat(data.disabledScopes || []);
                disabledScopes.forEach(scope => {
                    scope = scope.toLowerCase().trim();
                    if (allowedScopes.includes(scope)) {
                        scopeSet.add(scope);
                    }
                });
                $set.disabledScopes = Array.from(scopeSet).sort((a, b) => a.localeCompare(b));
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

            if (data.hashedPassword) {
                // try if the bcrypt library can handle it?
                return hashes.compare('whatever', $set.password, err => {
                    if (err) {
                        return done(err);
                    }
                    // did not throw, so probably OK, no need to update `$set.password`
                    return done();
                });
            }

            hashes.hash($set.password, (err, hash) => {
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
                err.code = 'HashError';
                return callback(err);
            }

            let verifyExistingPassword = next => {
                this.users.collection('users').findOne(
                    { _id: user },
                    {
                        projection: {
                            password: true,
                            oldPasswords: true
                        },
                        maxTimeMS: consts.DB_MAX_TIME_USERS
                    },
                    (err, userData) => {
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

                        hashes.compare(data.existingPassword, userData.password, (err, success) => {
                            if (err) {
                                log.error('DB', 'HASHFAIL user.update id=%s error=%s', data.username, err.message);
                                err.code = err.code || 'HashError';
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
                    }
                );
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
                        returnOriginal: false,
                        maxTimeMS: consts.DB_MAX_TIME_USERS
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
                        if (flushKeys.length || flushHKeys.length) {
                            let flushreq = this.redis.multi();

                            flushKeys.forEach(key => {
                                flushreq = flushreq.del(key);
                            });

                            flushHKeys.forEach(entry => {
                                flushreq = flushreq.hdel(entry.key, entry.value);
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

    getMailboxes(language, defaults) {
        defaults = defaults || {};

        let lcode = (language || '')
            .toLowerCase()
            .split('_')
            .shift();

        let translation = lcode && mailboxTranslations.hasOwnProperty(lcode) ? mailboxTranslations[lcode] : mailboxTranslations.en;

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
            path: mailbox.path === 'INBOX' ? 'INBOX' : defaults[mailbox.specialUse] || translation[mailbox.specialUse || mailbox.path] || mailbox.path,
            specialUse: mailbox.specialUse,
            uidValidity,
            uidNext: 1,
            modifyIndex: 0,
            subscribed: true,
            flags: []
        }));
    }

    logAuthEvent(user, entry, callback) {
        // only log auth events if we have a valid user id and logging is not disabled
        if (!user || !tools.isId(user) || this.authlogExpireDays === false) {
            return callback();
        }

        let now = new Date();

        entry.user = typeof user === 'string' ? new ObjectID(user) : user;
        entry.action = entry.action || 'authentication';
        entry.created = now;

        if (typeof this.authlogExpireDays === 'number' && this.authlogExpireDays !== 0) {
            // this entry expires in set days
            entry.expires = new Date(Date.now() + Math.abs(this.authlogExpireDays) * 24 * 3600 * 1000);
        }

        // key is for merging similar events
        entry.key = crypto
            .createHash('md5')
            .update([entry.protocol, entry.ip, entry.action, entry.result].map(v => (v || '').toString()).join('^'))
            .digest();

        return this.users.collection('authlog').findOneAndUpdate(
            {
                user: entry.user,
                created: {
                    // merge similar events into buckets of time
                    $gte: new Date(Date.now() - consts.AUTHLOG_BUCKET)
                },
                // events are merged based on this key
                key: entry.key
            },
            {
                $setOnInsert: entry,
                $inc: {
                    events: 1
                },
                $set: {
                    last: now
                }
            },
            {
                upsert: true,
                projection: { _id: true },
                returnOriginal: false,
                maxTimeMS: consts.DB_MAX_TIME_USERS
            },
            (err, r) => {
                if (err) {
                    return callback(err);
                }
                return callback(null, r && r.value && r.value._id);
            }
        );
    }

    logout(user, reason, callback) {
        // register this address as the default address for that user
        return this.users.collection('users').findOne(
            {
                _id: new ObjectID(user)
            },
            {
                projection: {
                    _id: true
                },
                maxTimeMS: consts.DB_MAX_TIME_USERS
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

        let tryCount = 0;
        let tryDelete = err => {
            if (tryCount++ > 10) {
                return callback(err);
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

                    // set up a task to delete user messages
                    let now = new Date();
                    this.database.collection('tasks').insertOne(
                        {
                            task: 'user-delete',
                            locked: false,
                            lockedUntil: now,
                            created: now,
                            status: 'queued',
                            user
                        },
                        () =>
                            this.logAuthEvent(
                                user,
                                {
                                    action: 'delete user',
                                    result: 'success',
                                    sess: meta.session,
                                    ip: meta.ip
                                },
                                () => callback(null, true)
                            )

                    );
                });
            });
        };
        setImmediate(tryDelete);
    }

    // returns a query to find an user based on address or username
    checkAddress(username, callback) {
        if (username.indexOf('@') < 0) {
            // not formatted as an address, assume regular username
            return callback(null, {
                unameview: tools.uview(username)
            });
        }

        this.resolveAddress(
            username,
            {
                wildcard: false,
                projection: {
                    user: true
                }
            },
            (err, addressData) => {
                if (err) {
                    return callback(err);
                }

                if (addressData && !addressData.user) {
                    // found a non-user address
                    return callback(null, false);
                }

                if (!addressData) {
                    // fall back to username formatted as an address
                    return callback(null, {
                        unameview: tools.normalizeAddress(username, false, {
                            removeLabel: true,
                            removeDots: true
                        })
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
