'use strict';

const config = require('wild-config');
const Joi = require('@hapi/joi');
const ObjectID = require('mongodb').ObjectID;
const mobileconfig = require('mobileconfig');
const uuid = require('uuid');
const consts = require('../consts');
const certs = require('../certs').get('api.mobileconfig');
const tools = require('../tools');
const roles = require('../roles');
const util = require('util');

module.exports = (db, server, userHandler) => {
    const mobileconfigGetSignedConfig = util.promisify(mobileconfig.getSignedConfig.bind(mobileconfig));

    /**
     * @api {get} /users/:user/asps List Application Passwords
     * @apiName GetASPs
     * @apiGroup ApplicationPasswords
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {Boolean} [showAll=false] If not true then skips entries with a TTL set
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} results Event listing
     * @apiSuccess {String} results.id ID of the Application Password
     * @apiSuccess {String} results.description Description
     * @apiSuccess {String[]} results.scopes Allowed scopes for the Application Password
     * @apiSuccess {Object} results.lastUse Information about last use
     * @apiSuccess {String} results.lastUse.time Datestring of last use or false if password has not been used
     * @apiSuccess {String} results.lastUse.event Event ID of the security log for the last authentication
     * @apiSuccess {String} results.created Datestring
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/asps"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "results": [
     *         {
     *           "id": "5a1d6dd776e56b6d97e5dd48",
     *           "description": "Thunderbird",
     *           "scopes": [
     *             "imap",
     *             "smtp"
     *           ],
     *           "lastUse": {
     *              "time": "2018-06-21T16:51:53.807Z",
     *              "event": "5b2bd7a9d0ba2509deb88f40"
     *           },
     *           "created": "2017-11-28T14:08:23.520Z"
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
    server.get(
        '/users/:user/asps',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                showAll: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            if (req.query.showAll) {
                req.params.showAll = req.query.showAll;
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
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('asps'));
            } else {
                req.validate(roles.can(req.role).readAny('asps'));
            }

            let user = new ObjectID(result.value.user);
            let showAll = result.value.showAll;

            let userData;

            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            address: true
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

            let asps;
            try {
                asps = await db.users
                    .collection('asps')
                    .find({
                        user
                    })
                    .sort({ _id: 1 })
                    .toArray();
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!asps) {
                asps = [];
            }

            res.json({
                success: true,

                results: asps
                    .filter(asp => {
                        if (showAll) {
                            return true;
                        }
                        if (asp.ttl) {
                            return false;
                        }
                        return true;
                    })
                    .map(asp => ({
                        id: asp._id,
                        description: asp.description,
                        scopes: asp.scopes.includes('*') ? [...consts.SCOPES] : asp.scopes,
                        lastUse: {
                            time: asp.used || false,
                            event: asp.authEvent || false
                        },
                        expires: asp.expires,
                        created: asp.created
                    }))
            });

            return next();
        })
    );

    /**
     * @api {get} /users/:user/asps/:asp Request ASP information
     * @apiName GetASP
     * @apiGroup ApplicationPasswords
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} asp ID of the Application Specific Password
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Application Password
     * @apiSuccess {String} description Description
     * @apiSuccess {String[]} scopes Allowed scopes for the Application Password
     * @apiSuccess {Object} lastUse Information about last use
     * @apiSuccess {String} lastUse.time Datestring of last use or false if password has not been used
     * @apiSuccess {String} lastUse.event Event ID of the security log for the last authentication
     * @apiSuccess {String} created Datestring
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i "http://localhost:8080/users/59fc66a03e54454869460e45/asps/5a1d6dd776e56b6d97e5dd48"
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1d6dd776e56b6d97e5dd48",
     *       "description": "Thunderbird",
     *       "scopes": [
     *         "imap",
     *         "smtp"
     *       ],
     *       "lastUse": {
     *          "time": "2018-06-21T16:51:53.807Z",
     *          "event": "5b2bd7a9d0ba2509deb88f40"
     *       },
     *       "created": "2017-11-28T14:08:23.520Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.get(
        '/users/:user/asps/:asp',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                asp: Joi.string()
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).readOwn('asps'));
            } else {
                req.validate(roles.can(req.role).readAny('asps'));
            }

            let user = new ObjectID(result.value.user);
            let asp = new ObjectID(result.value.asp);

            let aspData;

            try {
                aspData = await db.users.collection('asps').findOne({
                    _id: asp,
                    user
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!aspData) {
                res.json({
                    error: 'Invalid or unknown ASP key',
                    code: 'AspNotFound'
                });
                return next();
            }

            res.json({
                success: true,
                id: aspData._id,
                description: aspData.description,
                scopes: aspData.scopes.includes('*') ? [...consts.SCOPES] : aspData.scopes,
                lastUse: {
                    time: aspData.used || false,
                    event: aspData.authEvent || false
                },
                expires: asp.expires,
                created: aspData.created
            });

            return next();
        })
    );

    /**
     * @api {post} /users/:user/asps Create new Application Password
     * @apiName PostASP
     * @apiGroup ApplicationPasswords
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} description Description
     * @apiParam {String[]} scopes List of scopes this Password applies to. Special scope "*" indicates that this password can be used for any scope except "master"
     * @apiParam {Boolean} [generateMobileconfig] If true then result contains a mobileconfig formatted file with account config
     * @apiParam {String} [address] E-mail address to be used as the account address in mobileconfig file. Must be one of the listed identity addresses of the user. Defaults to the main address of the user
     * @apiParam {Number} [ttl] TTL in seconds for this password. Every time password is used, TTL is reset to this value
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID of the Application Password
     * @apiSuccess {String} password Application Specific Password. Generated password is whitespace agnostic, so it could be displayed to the client as "abcd efgh ijkl mnop" instead of "abcdefghijklmnop"
     * @apiSuccess {String} mobileconfig Base64 encoded mobileconfig file. Generated profile file should be sent to the client with <code>Content-Type</code> value of <code>application/x-apple-aspen-config</code>.
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/asps \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "description": "Thunderbird",
     *       "scopes": ["imap", "smtp"],
     *       "generateMobileconfig": true
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1d6dd776e56b6d97e5dd48",
     *       "password": "rflhmllyegblyybd",
     *       "mobileconfig": "MIIQBgYJKoZIhvcNAQcCoIIP9..."
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Database error"
     *     }
     */
    server.post(
        '/users/:user/asps',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                description: Joi.string()
                    .trim()
                    .max(255)
                    .required(),
                scopes: Joi.array()
                    .items(
                        Joi.string()
                            .valid(...consts.SCOPES, '*')
                            .required()
                    )
                    .unique(),
                address: Joi.string()
                    .empty('')
                    .email(),
                generateMobileconfig: Joi.boolean()
                    .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                    .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                    .default(false),
                ttl: Joi.number().empty([0, '']),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            if (typeof req.params.scopes === 'string') {
                req.params.scopes = req.params.scopes
                    .split(',')
                    .map(scope => scope.trim())
                    .filter(scope => scope);
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
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('asps'));
            } else {
                req.validate(roles.can(req.role).createAny('asps'));
            }

            let user = new ObjectID(result.value.user);
            let generateMobileconfig = result.value.generateMobileconfig;
            let scopes = result.value.scopes || ['*'];
            let description = result.value.description;

            if (scopes.includes('*')) {
                scopes = ['*'];
            }

            if (generateMobileconfig && !scopes.includes('*') && ((!scopes.includes('imap') && !scopes.includes('pop3')) || !scopes.includes('smtp'))) {
                res.json({
                    error: 'Profile file requires either imap or pop3 and smtp scopes',
                    code: 'InvalidAuthScope'
                });
                return next();
            }

            let userData;
            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            username: true,
                            name: true,
                            address: true
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

            let accountType;
            let accountHost;
            let accountPort;
            let accountSecure;
            let accountAddress;
            let accountName;

            if (result.value.address) {
                let addressData;
                try {
                    addressData = await db.users.collection('addresses').findOne({
                        addrview: tools.normalizeAddress(result.value.address, false, {
                            removeLabel: true,
                            removeDots: true
                        })
                    });
                } catch (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!addressData || !addressData.user.equals(userData._id)) {
                    res.json({
                        error: 'Invalid or unknown address',
                        code: 'AddressNotFound'
                    });
                    return next();
                }

                accountName = addressData.name || userData.name || '';
                accountAddress = addressData.address;
            } else {
                accountName = userData.name || '';
                accountAddress = userData.address;
            }

            let asp = await userHandler.generateASP(user, result.value);

            if (!generateMobileconfig) {
                res.json({
                    success: true,
                    id: asp.id,
                    password: asp.password
                });
                return next();
            }

            let profileOpts = {};
            Object.keys(config.api.mobileconfig || {}).forEach(key => {
                profileOpts[key] = (config.api.mobileconfig[key] || '')
                    .toString()
                    .replace(/\{email\}/g, accountAddress)
                    .replace(/\{name\}/g, accountName)
                    .trim();
            });

            if (scopes.includes('*') || scopes.includes('imap')) {
                // prefer IMAP
                accountType = 'EmailTypeIMAP';
                accountHost = config.imap.setup.hostname;
                accountPort = config.imap.setup.port || config.imap.port;
                accountSecure = !!config.imap.setup.secure;
            } else {
                accountType = 'EmailTypePOP';
                accountHost = config.pop3.setup.hostname;
                accountPort = config.pop3.setup.port || config.pop3.port;
                accountSecure = !!config.pop3.setup.secure;
            }

            let profile = await mobileconfigGetSignedConfig(
                {
                    PayloadType: 'Configuration',
                    PayloadVersion: 1,
                    PayloadIdentifier: profileOpts.identifier + '.' + userData._id,
                    PayloadUUID: uuid.v4(),
                    PayloadDisplayName: description || profileOpts.displayName,
                    PayloadDescription: profileOpts.displayDescription,
                    PayloadOrganization: profileOpts.organization || 'WildDuck Mail Server',

                    PayloadContent: [
                        {
                            PayloadType: 'com.apple.mail.managed',
                            PayloadVersion: 1,
                            PayloadIdentifier: profileOpts.identifier + '.' + userData._id,
                            PayloadUUID: uuid.v4(),
                            PayloadDisplayName: 'Email Account',
                            PayloadDescription: 'Configures email account',
                            PayloadOrganization: profileOpts.organization || 'WildDuck Mail Server',

                            EmailAccountDescription: profileOpts.accountDescription,
                            EmailAccountName: accountName,
                            EmailAccountType: accountType,
                            EmailAddress: accountAddress,
                            IncomingMailServerAuthentication: 'EmailAuthPassword',
                            IncomingMailServerHostName: accountHost,
                            IncomingMailServerPortNumber: accountPort,
                            IncomingMailServerUseSSL: accountSecure,
                            IncomingMailServerUsername: accountAddress,
                            IncomingPassword: asp.password,
                            OutgoingPasswordSameAsIncomingPassword: true,
                            OutgoingMailServerAuthentication: 'EmailAuthPassword',
                            OutgoingMailServerHostName: config.smtp.setup.hostname,
                            OutgoingMailServerPortNumber: config.smtp.setup.port || config.smtp.port,
                            OutgoingMailServerUseSSL: 'secure' in config.smtp.setup ? !!config.smtp.setup.secure : config.smtp.secure,
                            OutgoingMailServerUsername: accountAddress,
                            PreventMove: false,
                            PreventAppSheet: false,
                            SMIMEEnabled: false,
                            allowMailDrop: true
                        }
                    ]
                },
                certs
            );

            res.json({
                success: true,
                id: asp.id,
                name: accountName,
                address: accountAddress,
                password: asp.password,
                mobileconfig: profile.toString('base64')
            });
            return next();
        })
    );

    /**
     * @api {delete} /users/:user/asps/:asp Delete an Application Password
     * @apiName DeleteASP
     * @apiGroup ApplicationPasswords
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} asp ID of the Application Password
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE "http://localhost:8080/users/59fc66a03e54454869460e45/asps/5a1d6dd776e56b6d97e5dd48"
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
     *       "error": "Database error"
     *     }
     */
    server.del(
        '/users/:user/asps/:asp',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                asp: Joi.string()
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).deleteOwn('asps'));
            } else {
                req.validate(roles.can(req.role).deleteAny('asps'));
            }

            let user = new ObjectID(result.value.user);
            let asp = new ObjectID(result.value.asp);

            await userHandler.deleteASP(user, asp, result.value);

            res.json({
                success: true
            });
            return next();
        })
    );
};
