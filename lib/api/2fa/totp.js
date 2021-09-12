'use strict';

const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../../tools');
const roles = require('../../roles');
const { sessSchema, sessIPSchema } = require('../../schemas');

module.exports = (db, server, userHandler) => {
    // Create TOTP seed and request a QR code

    server.post(
        '/users/:user/2fa/totp/setup',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');
            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                label: Joi.string().empty('').trim().max(255),
                issuer: Joi.string().trim().max(255).required(),
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
            let totp = await userHandler.setupTotp(user, result.value);

            res.json({
                success: true,
                seed: totp.secret,
                qrcode: totp.dataUrl
            });

            return next();
        })
    );

    server.post(
        '/users/:user/2fa/totp/enable',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                token: Joi.string().length(6).required(),
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
            let { success, disabled2fa } = await userHandler.enableTotp(user, result.value);

            if (!success) {
                res.status(400);
                res.json({
                    error: 'Invalid authentication token',
                    code: 'InvalidToken'
                });
                return next();
            }

            if (disabled2fa && req.accessToken && typeof req.accessToken.update === 'function') {
                try {
                    // update access token data for current session after U2F enabled
                    await req.accessToken.update();
                } catch (err) {
                    // ignore
                }
            }

            res.json({
                success
            });

            return next();
        })
    );

    server.del(
        '/users/:user/2fa/totp',
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
            let success = await userHandler.disableTotp(user, result.value);

            res.json({
                success
            });

            return next();
        })
    );

    server.post(
        '/users/:user/2fa/totp/check',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                token: Joi.string().length(6).required(),
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
            let totp = await userHandler.checkTotp(user, result.value);

            if (!totp) {
                res.status(403);
                res.json({
                    error: 'Failed to validate TOTP',
                    code: 'InvalidToken'
                });
                return next();
            }

            res.json({
                success: true
            });

            return next();
        })
    );

    server.del(
        '/users/:user/2fa',
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
            let success = await userHandler.disable2fa(user, result.value);

            res.json({
                success
            });

            return next();
        })
    );
};
