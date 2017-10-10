'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

const U2F_ERRORS = new Map([
    [1, 'Unknown error'],
    [2, 'Bad request'],
    [3, 'Client configuration is not supported'],
    [4, 'The presented device is not eligible for this request'],
    [5, 'Timeout reached while waiting for key']
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
    /*
var t = {
    registrationData:
        'BQSp4XE8GaJNIHEpWRa6sVkKeIcCqr2ODhi9FL9b4ac70ttiKH9I4rK6Y7eV9HVFQX78T_YyYhXL89__bZxmjX4TQJQZHupSA74vy9WPHjnBA69G1tfLfjQ4nFxiscGneMh2PTBzPjUyKBlHJkg_WJtVCThL2Lbc5WQ8ziU37c52uLEwggJEMIIBLqADAgECAgRVYr6gMAsGCSqGSIb3DQEBCzAuMSwwKgYDVQQDEyNZdWJpY28gVTJGIFJvb3QgQ0EgU2VyaWFsIDQ1NzIwMDYzMTAgFw0xNDA4MDEwMDAwMDBaGA8yMDUwMDkwNDAwMDAwMFowKjEoMCYGA1UEAwwfWXViaWNvIFUyRiBFRSBTZXJpYWwgMTQzMjUzNDY4ODBZMBMGByqGSM49AgEGCCqGSM49AwEHA0IABEszH3c9gUS5mVy-RYVRfhdYOqR2I2lcvoWsSCyAGfLJuUZ64EWw5m8TGy6jJDyR_aYC4xjz_F2NKnq65yvRQwmjOzA5MCIGCSsGAQQBgsQKAgQVMS4zLjYuMS40LjEuNDE0ODIuMS41MBMGCysGAQQBguUcAgEBBAQDAgUgMAsGCSqGSIb3DQEBCwOCAQEArBbZs262s6m3bXWUs09Z9Pc-28n96yk162tFHKv0HSXT5xYU10cmBMpypXjjI-23YARoXwXn0bm-BdtulED6xc_JMqbK-uhSmXcu2wJ4ICA81BQdPutvaizpnjlXgDJjq6uNbsSAp98IStLLp7fW13yUw-vAsWb5YFfK9f46Yx6iakM3YqNvvs9M9EUJYl_VrxBJqnyLx2iaZlnpr13o8NcsKIJRdMUOBqt_ageQg3ttsyq_3LyoNcu7CQ7x8NmeCGm_6eVnZMQjDmwFdymwEN4OxfnM5MkcKCYhjqgIGruWkVHsFnJa8qjZXneVvKoiepuUQyDEJ2GcqvhU2YKY1zBEAiBKahEVX1Kw2X6rL1kKeskPU-fNqwqLo5S1ylHDcesRpgIgPNg0uHVswZquH6YLfUSNUKg_bYBGXOxHKWH5qNl2bB4',
    version: 'U2F_V2',
    challenge: '2kbypDmNIkM6-oaVKjB7ZN1J1jiyzoU8WxLGX8yVUpY',
    clientData:
        'eyJ0eXAiOiJuYXZpZ2F0b3IuaWQuZmluaXNoRW5yb2xsbWVudCIsImNoYWxsZW5nZSI6IjJrYnlwRG1OSWtNNi1vYVZLakI3Wk4xSjFqaXl6b1U4V3hMR1g4eVZVcFkiLCJvcmlnaW4iOiJodHRwczovL2xvY2FsaG9zdDozMDAwIiwiY2lkX3B1YmtleSI6InVudXNlZCJ9'
};

 */

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
            res.json({
                error: U2F_ERRORS.get(result.value.errorCode) || 'Unknown error'
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
            res.json({
                error: U2F_ERRORS.get(result.value.errorCode) || 'Unknown error'
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
