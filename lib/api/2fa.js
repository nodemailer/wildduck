'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

module.exports = (db, server, userHandler) => {
    server.post('/users/:user/2fa', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
            issuer: Joi.string().trim().max(255).required(),
            fresh: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).default(false),
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

        userHandler.setup2fa(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
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

    server.get('/users/:user/2fa', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
            token: Joi.string().length(6).required(),
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

        userHandler.check2fa(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Invalid authentication token'
                });
                return next();
            }

            res.json({
                success: true
            });

            return next();
        });
    });

    server.put('/users/:user/2fa', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
            token: Joi.string().length(6).required(),
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

        userHandler.enable2fa(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Invalid authentication token'
                });
                return next();
            }

            res.json({
                success: true
            });

            return next();
        });
    });

    server.del('/users/:user/2fa', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string().hex().lowercase().length(24).required(),
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

        userHandler.disable2fa(user, result.value, (err, result) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            if (!result) {
                res.json({
                    error: 'Invalid authentication token'
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
