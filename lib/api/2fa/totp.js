'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

module.exports = (db, server, userHandler) => {
    // Create TOTP seed and request a QR code

    /**
     * @api {post} /users/:user/2fa/totp/setup Generate TOTP seed
     * @apiName SetupTotp2FA
     * @apiGroup TwoFactorAuth
     * @apiDescription This method generates TOTP seed and QR code for 2FA. User needs to verify the seed value using 2fa/totp/enable endpoint
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} [label] Label text for QR code (defaults to username)
     * @apiParam {String} [issuer] Description text for QR code (defaults to "WildDuck")
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} seed Generated TOTP seed value
     * @apiSuccess {String} qrcode Base64 encoded QR code
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp/setup \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "label": "user@example.com",
     *       "issuer": "My Awesome Web Service",
     *       "ip": "127.0.0.1"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "seed": "secretseed",
     *       "qrcode": "base64-encoded-image"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This username does not exist"
     *       "code": "UserNotFound"
     *     }
     */
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
                seed: result.secret,
                qrcode: result.dataUrl
            });

            return next();
        });
    });

    /**
     * @api {post} /users/:user/2fa/totp/enable Enable TOTP seed
     * @apiName EnableTotp2FA
     * @apiGroup TwoFactorAuth
     * @apiDescription This method enables TOTP for an user by verifying the seed value generated from 2fa/totp/setup
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} token 6-digit number that matches seed value from 2fa/totp/setup
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp/enable \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "token": "123456",
     *       "ip": "127.0.0.1"
     *     }'
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
     *       "error": "This username does not exist"
     *       "code": "UserNotFound"
     *     }
     */
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

    /**
     * @api {delete} /users/:user/2fa/totp Disable TOTP auth
     * @apiName DisableTotp2FA
     * @apiGroup TwoFactorAuth
     * @apiDescription This method disables TOTP for an user. Does not affect other 2FA mechanisms an user might have set up
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp
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
     *       "error": "This username does not exist"
     *       "code": "UserNotFound"
     *     }
     */
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

    /**
     * @api {post} /users/:user/2fa/totp/check Validate TOTP Token
     * @apiName CheckTotp2FA
     * @apiGroup TwoFactorAuth
     * @apiDescription This method checks if a TOTP token provided by an User is valid for authentication
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} token 6-digit number
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/users/59fc66a03e54454869460e45/2fa/totp/check \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "token": "123456",
     *       "ip": "127.0.0.1"
     *     }'
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
     *       "error": "Failed to validate TOTP"
     *       "code": "InvalidToken"
     *     }
     */
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

    /**
     * @api {delete} /users/:user/2fa Disable 2FA
     * @apiName Disable2FA
     * @apiGroup TwoFactorAuth
     * @apiDescription This method disables all 2FA mechanisms an user might have set up
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/2fa
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
     *       "error": "This username does not exist"
     *       "code": "UserNotFound"
     *     }
     */
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
