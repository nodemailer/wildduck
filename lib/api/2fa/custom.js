'use strict';

const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../../tools');
const roles = require('../../roles');
const { sessSchema, sessIPSchema } = require('../../schemas');

// Custom 2FA needs to be enabled if your website handles its own 2FA and you want to disable
// master password usage for IMAP/POP/SMTP clients

module.exports = (db, server, userHandler) => {
    server.put(
        '/users/:user/2fa/custom',
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
            let userHandlerResponse = await userHandler.enableCustom2fa(user, result.value);

            res.json({
                success: userHandlerResponse.success
            });

            return next();
        })
    );

    server.del(
        '/users/:user/2fa/custom',
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
            let disabled2fa = await userHandler.disableCustom2fa(user, result.value);

            if (!disabled2fa) {
                res.status(500);
                res.json({
                    error: 'Failed to disable 2FA',
                    code: '2FADisableFailed'
                });
                return next();
            }

            if (disabled2fa && req.accessToken && typeof req.accessToken.update === 'function') {
                try {
                    // update access token data for current session after custom 2FA disabled
                    await req.accessToken.update();
                } catch (err) {
                    // ignore
                }
            }

            res.json({
                success: true
            });

            return next();
        })
    );
};
