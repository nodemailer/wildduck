'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

const U2F_ERROR_CODES = {
    OK: 0,
    OTHER_ERROR: 1,
    BAD_REQUEST: 2,
    CONFIGURATION_UNSUPPORTED: 3,
    DEVICE_INELIGIBLE: 4,
    TIMEOUT: 5
};

const U2F_ERROR_MESSAGES = new Map([
    [U2F_ERROR_CODES.OTHER_ERROR, 'Unknown error'],
    [U2F_ERROR_CODES.BAD_REQUEST, 'Bad request'],
    [U2F_ERROR_CODES.CONFIGURATION_UNSUPPORTED, 'Client configuration is not supported'],
    [U2F_ERROR_CODES.DEVICE_INELIGIBLE, 'The presented device is not eligible for this request'],
    [U2F_ERROR_CODES.TIMEOUT, 'Timed out waiting for security key activation.']
]);

module.exports = (db, server, userHandler) => {
    // Create U2F keys
    server.post('/users/:user/2fa/u2f/setup', (req, res, next) => {
        res.charSet('utf-8');
        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        userHandler.setupU2f(user, result.value, (err, u2fRegRequest) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            res.json({
                success: true,
                u2fRegRequest
            });

            return next();
        });
    });

    // Send response from U2F key
    server.post('/users/:user/2fa/u2f/enable', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            errorCode: Joi.number().max(100),
            clientData: Joi.string()
                .regex(/^[0-9a-z\-_]+$/i, 'web safe base64')
                .max(10240),
            registrationData: Joi.string()
                .regex(/^[0-9a-z\-_]+$/i, 'web safe base64')
                .max(10240),
            version: Joi.string().allow('U2F_V2'),
            challenge: Joi.string()
                .regex(/^[0-9a-z\-_]+$/i, 'web safe base64')
                .max(1024),
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
                error: result.error.message
            });
            return next();
        }

        if (result.value.errorCode) {
            let error;

            switch (result.value.errorCode) {
                case U2F_ERROR_CODES.DEVICE_INELIGIBLE:
                    error = 'U2F token is already registered';
                    break;
                default:
                    error = U2F_ERROR_MESSAGES.get(result.value.errorCode) || 'Unknown error code' + result.value.errorCode;
            }

            res.json({
                error
            });

            return next();
        }

        let user = new ObjectID(result.value.user);

        userHandler.enableU2f(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Failed to enable U2F'
                });
                return next();
            }

            res.json({
                success: true
            });

            return next();
        });
    });

    // Disable U2F auth for an user
    server.del('/users/:user/2fa/u2f', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        userHandler.disableU2f(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Failed to disable U2F'
                });
                return next();
            }

            res.json({
                success: true
            });

            return next();
        });
    });

    // Generate U2F Authentciation Request
    server.post('/users/:user/2fa/u2f/start', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
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
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);

        userHandler.startU2f(user, result.value, (err, u2fAuthRequest) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Failed to generate authentication request for U2F'
                });
                return next();
            }

            res.json({
                success: true,
                u2fAuthRequest
            });

            return next();
        });
    });

    // Send response from U2F key
    server.post('/users/:user/2fa/u2f/check', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            errorCode: Joi.number().max(100),
            clientData: Joi.string()
                .regex(/^[0-9a-z\-_]+$/i, 'web safe base64')
                .max(10240),
            signatureData: Joi.string()
                .regex(/^[0-9a-z\-_]+$/i, 'web safe base64')
                .max(10240),
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
                error: result.error.message
            });
            return next();
        }

        if (result.value.errorCode) {
            let error;

            switch (result.value.errorCode) {
                case U2F_ERROR_CODES.DEVICE_INELIGIBLE:
                    error = 'U2F token is not registered';
                    break;
                default:
                    error = U2F_ERROR_MESSAGES.get(result.value.errorCode) || 'Unknown error code' + result.value.errorCode;
            }

            res.json({
                error
            });

            return next();
        }

        let user = new ObjectID(result.value.user);

        userHandler.checkU2f(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Failed to validate U2F request'
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
