'use strict';

const config = require('wild-config');
const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const mobileconfig = require('mobileconfig');
const uuid = require('uuid');
const consts = require('../consts');
const certs = require('../certs').get('api.mobileconfig');
const tools = require('../tools');
const roles = require('../roles');
const util = require('util');
const { sessSchema, sessIPSchema, booleanSchema } = require('../schemas');

module.exports = (db, server, userHandler) => {
    const mobileconfigGetSignedConfig = util.promisify(mobileconfig.getSignedConfig.bind(mobileconfig));

    server.get(
        '/users/:user/asps',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                showAll: booleanSchema.default(false),
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
                req.validate(roles.can(req.role).readOwn('asps'));
            } else {
                req.validate(roles.can(req.role).readAny('asps'));
            }

            let user = new ObjectId(result.value.user);
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
                res.status(500);
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
                        id: asp._id.toString(),
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

    server.get(
        '/users/:user/asps/:asp',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                asp: Joi.string().hex().lowercase().length(24).required(),
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
                req.validate(roles.can(req.role).readOwn('asps'));
            } else {
                req.validate(roles.can(req.role).readAny('asps'));
            }

            let user = new ObjectId(result.value.user);
            let asp = new ObjectId(result.value.asp);

            let aspData;

            try {
                aspData = await db.users.collection('asps').findOne({
                    _id: asp,
                    user
                });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!aspData) {
                res.status(404);
                res.json({
                    error: 'Invalid or unknown ASP key',
                    code: 'AspNotFound'
                });
                return next();
            }

            res.json({
                success: true,
                id: aspData._id.toString(),
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

    server.post(
        '/users/:user/asps',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                description: Joi.string().trim().max(255).required(),
                scopes: Joi.array()
                    .items(
                        Joi.string()
                            .valid(...consts.SCOPES, '*')
                            .required()
                    )
                    .unique(),
                address: Joi.string().empty('').email({ tlds: false }),
                password: Joi.string()
                    .empty('')
                    .pattern(/^[a-z]{16}$/, { name: 'password' }),
                generateMobileconfig: booleanSchema.default(false),
                ttl: Joi.number().empty([0, '']),
                sess: sessSchema,
                ip: sessIPSchema
            });

            if (typeof req.params.scopes === 'string') {
                req.params.scopes = req.params.scopes
                    .split(',')
                    .map(scope => scope.trim())
                    .filter(scope => scope);
            }

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
                req.validate(roles.can(req.role).createOwn('asps'));
            } else {
                req.validate(roles.can(req.role).createAny('asps'));
            }

            let user = new ObjectId(result.value.user);
            let generateMobileconfig = result.value.generateMobileconfig;
            let scopes = result.value.scopes || ['*'];
            let description = result.value.description;

            if (scopes.includes('*')) {
                scopes = ['*'];
            }

            if (generateMobileconfig && !scopes.includes('*') && ((!scopes.includes('imap') && !scopes.includes('pop3')) || !scopes.includes('smtp'))) {
                res.status(400);
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
                    res.status(500);
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        code: 'InternalDatabaseError'
                    });
                    return next();
                }

                if (!addressData || !addressData.user.equals(userData._id)) {
                    res.status(404);
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

    server.del(
        '/users/:user/asps/:asp',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                asp: Joi.string().hex().lowercase().length(24).required(),
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
                req.validate(roles.can(req.role).deleteOwn('asps'));
            } else {
                req.validate(roles.can(req.role).deleteAny('asps'));
            }

            let user = new ObjectId(result.value.user);
            let asp = new ObjectId(result.value.asp);

            await userHandler.deleteASP(user, asp, result.value);

            res.json({
                success: true
            });
            return next();
        })
    );
};
