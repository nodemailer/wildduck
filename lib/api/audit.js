'use strict';

const Joi = require('../joi');
const tools = require('../tools');
const roles = require('../roles');
const ObjectID = require('mongodb').ObjectID;

module.exports = (db, server, auditHandler) => {
    /**
     * @api {post} /audit Create new audit
     * @apiName PostAudit
     * @apiGroup Audit
     * @apiDescription Initiates a message audit
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID.
     * @apiParam {String} [start] Start time as ISO date
     * @apiParam {String} [end] End time as ISO date
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID for the created Audit
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST "http://localhost:8080/audit" \
     *     -H 'X-Access-Token: 1bece61c4758f02f47d3896bdc425959566b06ac' \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *         "user": "5a1bda70bfbd1442cd96c6f0"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "59fc66a13e54454869460e58"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Failed to process request"
     *     }
     */
    server.post(
        '/audit',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string()
                    .hex()
                    .lowercase()
                    .length(24)
                    .required(),
                start: Joi.date()
                    .empty('')
                    .allow(false),
                end: Joi.date()
                    .empty('')
                    .allow(false),
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
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            req.validate(roles.can(req.role).updateAny('audit'));

            let user = new ObjectID(result.value.user);
            let start = result.value.start;
            let end = result.value.end;

            let audit = await auditHandler.create({
                user,
                start,
                end
            });

            res.json({
                success: true,
                id: audit
            });
            return next();
        })
    );
};
