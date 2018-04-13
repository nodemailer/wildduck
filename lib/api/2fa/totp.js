'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

module.exports = (db, server, userHandler) => {
    // Create TOTP seed and request a QR code
    server.post('/users/:user/2fa/totp/setup', (req, res, next) => {
        res.charSet('utf-8');
        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            label: Joi.string()
                .empty('')
                .trim()
                .max(255),
            issuer: Joi.string()
                .trim()
                .max(255)
                .required(),
            fresh: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 'on', 1])
                .falsy(['N', 'false', 'no', 'off', 0, ''])
                .default(false),
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

        userHandler.setupTotp(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success: true,
                qrcode: result
            });

            return next();
        });
    });

    // Send token from QR code to enable TOTP auth for a client
    server.post('/users/:user/2fa/totp/enable', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            token: Joi.string()
                .length(6)
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

        userHandler.enableTotp(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Invalid authentication token',
                    code: 'InvalidToken'
                });
                return next();
            }

            res.json({
                success: true
            });

            return next();
        });
    });

    // Disable TOTP auth for an user
    server.del('/users/:user/2fa/totp', (req, res, next) => {
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

        req.query.user = req.params.user;

        const result = Joi.validate(req.query, schema, {
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

        userHandler.disableTotp(user, result.value, (err, success) => {
            if (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success
            });

            return next();
        });
    });

    // Send current TOTP code to authenticate an user
    server.post('/users/:user/2fa/totp/check', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            token: Joi.string()
                .length(6)
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

        userHandler.checkTotp(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            if (!result) {
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
        });
    });

    // Disable 2FA auth for an user
    server.del('/users/:user/2fa', (req, res, next) => {
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

        req.query.user = req.params.user;

        const result = Joi.validate(req.query, schema, {
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

        userHandler.disable2fa(user, result.value, (err, success) => {
            if (err) {
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success
            });

            return next();
        });
    });
};
