'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

// Custom 2FA needs to be enabled if your website handles its own 2FA and you want to disable
// master password usage for IMAP/POP/SMTP clients

module.exports = (db, server, userHandler) => {
    /**
     * @api {put} /users/:user/2fa/custom Enable custom 2FA for an user
     * @apiName EnableCustom2FA
     * @apiGroup TwoFactorAuth
     * @apiDescription This method disables account password for IMAP/POP3/SMTP
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
     *     curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/2fa/custom \
     *     -H 'Content-type: application/json' \
     *     -d '{
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
    server.put('/users/:user/2fa/custom', (req, res, next) => {
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

        userHandler.enableCustom2fa(user, result.value, (err, success) => {
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
     * @api {delete} /users/:user/2fa/custom Disable custom 2FA for an user
     * @apiName DisableCustom2FA
     * @apiGroup TwoFactorAuth
     * @apiDescription This method disables custom 2FA. If it was the only 2FA set up, then account password for IMAP/POP3/SMTP gets enabled again
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
     *     curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/2fa/custom \
     *     -H 'Content-type: application/json' \
     *     -d '{
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
    server.del('/users/:user/2fa/custom', (req, res, next) => {
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

        userHandler.disableCustom2fa(user, result.value, (err, success) => {
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
