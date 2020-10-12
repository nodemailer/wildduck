'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const roles = require('../roles');
const { sessSchema, sessIPSchema } = require('../schemas');

module.exports = (db, server) => {
    /**
     * @api {post} /domainaccess/:tag/allow Add domain to allowlist
     * @apiDescription If an email is sent from a domain that is listed in the allowlist then it is never marked as spam. Lists apply for tagged users.
     * @apiName PostDomainAccessAllow
     * @apiGroup DomainAccess
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} tag Tag to match
     * @apiParam {String} domain Domain name to allowlist for users/addresses that include this tag
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID for the created record
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/domainaccess/account_12345/allow \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "domain": "example.com"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1c0ee490a34c67e266931c"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Invalid domain"
     *     }
     */

    /**
     * @api {post} /domainaccess/:tag/block Add domain to blocklist
     * @apiDescription If an email is sent from a domain that is listed in the blocklist then it is always marked as spam. Lists apply for tagged users.
     * @apiName PostDomainAccessBlock
     * @apiGroup DomainAccess
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} tag Tag to match
     * @apiParam {String} domain Domain name to blocklist for users/addresses that include this tag
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {String} id ID for the created record
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPOST http://localhost:8080/domainaccess/account_12345/block \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "domain": "example.com"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "id": "5a1c0ee490a34c67e266931c"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Invalid domain"
     *     }
     */
    server.post(
        '/domainaccess/:tag/:action',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                tag: Joi.string().trim().max(128).required(),
                domain: Joi.string()
                    .max(255)
                    //.hostname()
                    .required(),
                action: Joi.string().valid('allow', 'block').required(),
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
            req.validate(roles.can(req.role).createAny('domainaccess'));

            let domain = tools.normalizeDomain(result.value.domain);
            let tag = result.value.tag;
            let tagview = tag.toLowerCase();
            let action = result.value.action;

            let r;
            try {
                r = await db.database.collection('domainaccess').findOneAndUpdate(
                    {
                        tagview,
                        domain
                    },
                    {
                        $setOnInsert: {
                            tag,
                            tagview,
                            domain
                        },

                        $set: {
                            action
                        }
                    },
                    {
                        upsert: true,
                        projection: { _id: true },
                        returnOriginal: false
                    }
                );
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: !!(r && r.value),
                id: r && r.value && r.value._id
            });

            return next();
        })
    );

    /**
     * @api {get} /domainaccess/:tag/allow List allowlisted domains
     * @apiName GetDomainAccessAllow
     * @apiGroup DomainAccess
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} tag Tag to look for
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} results Domain list
     * @apiSuccess {String} results.id Entry ID
     * @apiSuccess {String} results.domain allowlisted domain name
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/domainaccess/account_12345/allow
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "results": [
     *         {
     *           "id": "5a1c0ee490a34c67e266931c",
     *           "domain": "example.com",
     *           "action": "allow"
     *         }
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Invalid ID"
     *     }
     */

    /**
     * @api {get} /domainaccess/:tag/block List blocklisted domains
     * @apiName GetDomainAccessBlock
     * @apiGroup DomainAccess
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} tag Tag to look for
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object[]} results Domain list
     * @apiSuccess {String} results.id Entry ID
     * @apiSuccess {String} results.domain blocklisted domain name
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/domainaccess/account_12345/block
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "results": [
     *         {
     *           "id": "5a1c0ee490a34c67e266931c",
     *           "domain": "example.com",
     *           "action": "block"
     *         }
     *       ]
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "Invalid ID"
     *     }
     */
    server.get(
        '/domainaccess/:tag/:action',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                tag: Joi.string().trim().max(128).required(),
                action: Joi.string().valid('allow', 'block').required(),

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
            req.validate(roles.can(req.role).readAny('domainaccess'));

            let tag = result.value.tag;
            let tagview = tag.toLowerCase();
            let action = result.value.action;

            let domains;
            try {
                domains = await db.database
                    .collection('domainaccess')
                    .find({
                        tagview,
                        action
                    })
                    .sort({
                        domain: 1
                    })
                    .toArray();
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!domains) {
                domains = [];
            }

            res.json({
                success: true,
                results: domains.map(domainData => {
                    return {
                        id: domainData._id,
                        domain: domainData.domain,
                        action
                    };
                })
            });

            return next();
        })
    );

    /**
     * @api {delete} /domainaccess/:domain Delete a Domain from listing
     * @apiName DeleteDomainAccess
     * @apiGroup DomainAccess
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} domain Listed domains unique ID
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/domainaccess/59fc66a03e54454869460e45
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
     *       "error": "This domain does not exist"
     *     }
     */
    server.del(
        '/domainaccess/:domain',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                domain: Joi.string().hex().lowercase().length(24).required(),
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
            req.validate(roles.can(req.role).deleteAny('domainaccess'));

            let domain = new ObjectID(result.value.domain);

            let r;

            try {
                r = await db.database.collection('domainaccess').deleteOne({
                    _id: domain
                });
            } catch (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            if (!r.deletedCount) {
                res.status(404);
                res.json({
                    error: 'Domain was not found',
                    code: 'DomainNotFound'
                });
                return next();
            }

            res.json({
                success: true,
                deleted: domain
            });
            return next();
        })
    );
};
