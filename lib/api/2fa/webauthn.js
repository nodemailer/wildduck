'use strict';

const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../../tools');
const roles = require('../../roles');
const { sessSchema, sessIPSchema, booleanSchema } = require('../../schemas');

module.exports = (db, server, userHandler) => {
    server.get(
        '/users/:user/2fa/webauthn/credentials',
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

            let userData = await db.users.collection('users').findOne(
                {
                    _id: user
                },
                {
                    projection: {
                        _id: true,
                        webauthn: true
                    }
                }
            );

            return res.json({
                success: true,
                credentials:
                    (userData.webauthn &&
                        userData.webauthn.credentials &&
                        userData.webauthn.credentials.map(credentialData => ({
                            id: credentialData._id.toString(),
                            rawId: credentialData.rawId.toString('hex'),
                            description: credentialData.description,
                            authenticatorAttachment: credentialData.authenticatorAttachment
                        }))) ||
                    []
            });
        })
    );

    server.del(
        '/users/:user/2fa/webauthn/credentials/:credential',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                credential: Joi.string().hex().lowercase().length(24).required(),
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
            let credential = new ObjectId(result.value.credential);

            let deleted = await userHandler.webauthnRemove(user, credential, result.value);

            return res.json({
                success: true,
                deleted
            });
        })
    );

    // Get webauthn challenge
    server.post(
        '/users/:user/2fa/webauthn/registration-challenge',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                description: Joi.string().empty('').max(1024).required().description('Descriptive name for the authenticator'),
                origin: Joi.string().empty('').uri().required(),

                authenticatorAttachment: Joi.string()
                    .valid('platform', 'cross-platform')
                    .example('cross-platform')
                    .default('cross-platform')
                    .description('Indicates whether authenticators should be part of the OS ("platform"), or can be roaming authenticators ("cross-platform")'),

                rpId: Joi.string().hostname().empty(''),

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
            let registrationOptions = await userHandler.webauthnGetRegistrationOptions(user, result.value);

            return res.json({
                success: true,
                registrationOptions
            });
        })
    );

    server.post(
        '/users/:user/2fa/webauthn/registration-attestation',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),

                challenge: Joi.string().empty('').hex().max(2048).required(),
                rawId: Joi.string().empty('').hex().max(2048).required(),
                clientDataJSON: Joi.string()
                    .empty('')
                    .hex()
                    .max(1024 * 1024)
                    .required(),
                attestationObject: Joi.string()
                    .empty('')
                    .hex()
                    .max(1024 * 1024)
                    .required(),

                rpId: Joi.string().hostname().empty(''),

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

            let response = await userHandler.webauthnAttestateRegistration(user, result.value);

            return res.json({
                success: true,
                response
            });
        })
    );

    // Get webauthn challenge
    server.post(
        '/users/:user/2fa/webauthn/authentication-challenge',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                origin: Joi.string().empty('').uri().required(),
                authenticatorAttachment: Joi.string()
                    .valid('platform', 'cross-platform')
                    .example('cross-platform')
                    .default('cross-platform')
                    .description('Indicates whether authenticators should be part of the OS ("platform"), or can be roaming authenticators ("cross-platform")'),

                rpId: Joi.string().hostname().empty(''),

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
                req.validate(roles.can(req.role).createOwn('authentication'));
            } else {
                req.validate(roles.can(req.role).createAny('authentication'));
            }

            let user = new ObjectId(result.value.user);
            let authenticationOptions = await userHandler.webauthnGetAuthenticationOptions(user, result.value);

            return res.json({
                success: true,
                authenticationOptions
            });
        })
    );

    server.post(
        '/users/:user/2fa/webauthn/authentication-assertion',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),

                challenge: Joi.string().empty('').hex().max(2048).required(),
                rawId: Joi.string().empty('').hex().max(2048).required(),
                clientDataJSON: Joi.string()
                    .empty('')
                    .hex()
                    .max(1024 * 1024)
                    .required(),
                authenticatorData: Joi.string()
                    .empty('')
                    .hex()
                    .max(1024 * 1024)
                    .required(),

                signature: Joi.string()
                    .empty('')
                    .hex()
                    .max(1024 * 1024)
                    .required(),

                rpId: Joi.string().hostname().empty(''),

                token: booleanSchema.default(false),

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

            let permission;

            if (req.user && req.user === result.value.user) {
                permission = roles.can(req.role).createOwn('authentication');
            } else {
                permission = roles.can(req.role).createAny('authentication');
            }

            // permissions check
            req.validate(permission);

            // filter out unallowed fields
            result.value = permission.filter(result.value);

            let user = new ObjectId(result.value.user);

            let authData = await userHandler.webauthnAssertAuthentication(user, result.value);

            let authResponse = {
                success: true,
                response: authData
            };

            if (result.value.token) {
                try {
                    authResponse.token = await userHandler.generateAuthToken(user);
                } catch (err) {
                    let response = {
                        error: err.message,
                        code: err.code || 'AuthFailed',
                        id: user.toString()
                    };
                    res.status(403);
                    return res.json(response);
                }
            }

            return res.json(permission.filter(authResponse));
        })
    );
};
