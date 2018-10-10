'use strict';

const config = require('wild-config');
const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const mobileconfig = require('mobileconfig');
const uuid = require('uuid');
const consts = require('../consts');
const certs = require('../certs').get('api.mobileconfig');

module.exports = (db, server, userHandler) => {
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
    server.get('/users/:user/asps', (req, res, next) => {
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
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                projection: {
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
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

                db.users
                    .collection('asps')
                    .find({
                        user
                    })
                    .sort({ _id: 1 })
                    .toArray((err, asps) => {
                        if (err) {
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

                            results: asps.map(asp => ({
                                id: asp._id,
                                description: asp.description,
                                scopes: asp.scopes.includes('*') ? [...consts.SCOPES] : asp.scopes,
                                lastUse: {
                                    time: asp.used || false,
                                    event: asp.authEvent || false
                                },
                                created: asp.created
                            }))
                        });

                        return next();
                    });
            }
        );
    });

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
    server.get('/users/:user/asps/:asp', (req, res, next) => {
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
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let asp = new ObjectID(result.value.asp);

        db.users.collection('asps').findOne(
            {
                _id: asp,
                user
            },
            (err, asp) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!asp) {
                    res.json({
                        error: 'Invalid or unknown ASP key',
                        code: 'AspNotFound'
                    });
                    return next();
                }

                res.json({
                    success: true,
                    id: asp._id,
                    description: asp.description,
                    scopes: asp.scopes.includes('*') ? [...consts.SCOPES] : asp.scopes,
                    lastUse: {
                        time: asp.used || false,
                        event: asp.authEvent || false
                    },
                    created: asp.created
                });

                return next();
            }
        );
    });

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
    server.post('/users/:user/asps', (req, res, next) => {
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
            generateMobileconfig: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', '1', 1])
                .falsy(['N', 'false', 'no', 'off', '0', 0, ''])
                .default(false),
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
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
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

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                projection: {
                    username: true,
                    name: true,
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
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

                userHandler.generateASP(user, result.value, (err, result) => {
                    if (err) {
                        res.json({
                            error: err.message
                        });
                        return next();
                    }

                    if (!generateMobileconfig) {
                        res.json({
                            success: true,
                            id: result.id,
                            password: result.password
                        });
                        return next();
                    }

                    let profileOpts = {};
                    Object.keys(config.api.mobileconfig || {}).forEach(key => {
                        profileOpts[key] = (config.api.mobileconfig[key] || '')
                            .toString()
                            .replace(/\{email\}/g, userData.address)
                            .trim();
                    });

                    let accountType;
                    let accountHost;
                    let accountPort;
                    let accountSecure;

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

                    mobileconfig.getSignedConfig(
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
                                    EmailAccountName: userData.name || userData.address,
                                    EmailAccountType: accountType,
                                    EmailAddress: userData.address,
                                    IncomingMailServerAuthentication: 'EmailAuthPassword',
                                    IncomingMailServerHostName: accountHost,
                                    IncomingMailServerPortNumber: accountPort,
                                    IncomingMailServerUseSSL: accountSecure,
                                    IncomingMailServerUsername: userData.address,
                                    IncomingPassword: result.password,
                                    OutgoingPasswordSameAsIncomingPassword: true,
                                    OutgoingMailServerAuthentication: 'EmailAuthPassword',
                                    OutgoingMailServerHostName: config.smtp.setup.hostname,
                                    OutgoingMailServerPortNumber: config.smtp.setup.port || config.smtp.port,
                                    OutgoingMailServerUseSSL: 'secure' in config.smtp.setup ? !!config.smtp.setup.secure : config.smtp.secure,
                                    OutgoingMailServerUsername: userData.address,
                                    PreventMove: false,
                                    PreventAppSheet: false,
                                    SMIMEEnabled: false,
                                    allowMailDrop: true
                                }
                            ]
                        },
                        certs,
                        (err, data) => {
                            if (err) {
                                res.json({
                                    error: err.message
                                });
                                return next();
                            }

                            res.json({
                                success: true,
                                id: result.id,
                                password: result.password,
                                mobileconfig: data.toString('base64')
                            });
                            return next();
                        }
                    );

                    /*
                    let options = {
                        displayName: description || profileOpts.displayName,
                        displayDescription: profileOpts.displayDescription,
                        accountDescription: profileOpts.accountDescription,
                        emailAddress: userData.address,
                        emailAccountName: userData.name,
                        identifier: profileOpts.identifier + '.' + userData.username,
                        imap: {
                            hostname: config.imap.setup.hostname,
                            port: config.imap.setup.port || config.imap.port,
                            secure: config.imap.setup.secure,
                            username: userData.username,
                            password: result.password
                        },
                        smtp: {
                            hostname: config.smtp.setup.hostname,
                            port: config.smtp.setup.port || config.smtp.port,
                            secure: true, //config.setup.smtp.secure,
                            username: userData.username,
                            password: false // use the same password as for IMAP
                        },
                        keys: certs
                    };

                    mobileconfig.getSignedEmailConfig(options, (err, data) => {
                        if (err) {
                            res.json({
                                error: err.message
                            });
                            return next();
                        }

                        res.json({
                            success: true,
                            id: result.id,
                            password: result.password,
                            mobileconfig: data.toString('base64')
                        });
                        return next();
                    });
                    */
                });
            }
        );
    });

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
    server.del('/users/:user/asps/:asp', (req, res, next) => {
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
            res.json({
                error: result.error.message,
                code: 'InputValidationError'
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let asp = new ObjectID(result.value.asp);

        userHandler.deleteASP(user, asp, result.value, err => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            res.json({
                success: true
            });
            return next();
        });
    });
};
