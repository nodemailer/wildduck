'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const roles = require('../roles');
const { sessSchema, sessIPSchema, booleanSchema } = require('../schemas');
const { publish, AUTOREPLY_USER_DISABLED, AUTOREPLY_USER_ENABLED } = require('../events');

module.exports = (db, server) => {
    /**
     * @api {put} /users/:user/autoreply Update Autoreply information
     * @apiName PutAutoreply
     * @apiGroup Autoreplies
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     * @apiParam {Boolean} [status] Is the autoreply enabled (true) or not (false)
     * @apiParam {String} [name] Name that is used for the From: header in autoreply message
     * @apiParam {String} [subject] Subject line for the autoreply. If empty then uses subject of the original message
     * @apiParam {String} [html] HTML formatted content of the autoreply message
     * @apiParam {String} [text] Plaintext formatted content of the autoreply message
     * @apiParam {String} [start] Datestring of the start of the autoreply or boolean false to disable start checks
     * @apiParam {String} [end] Datestring of the end of the autoreply or boolean false to disable end checks
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XPUT http://localhost:8080/users/59fc66a03e54454869460e45/autoreply \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "status": true,
     *       "text": "Away from office until Dec.19",
     *       "start": "2017-11-15T00:00:00.000Z",
     *       "end": "2017-12-19T00:00:00.000Z"
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
     *       "error": "This user does not exist"
     *     }
     */
    server.put(
        '/users/:user/autoreply',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                status: booleanSchema,
                name: Joi.string().allow('').trim().max(128),
                subject: Joi.string().allow('').trim().max(128),
                text: Joi.string()
                    .allow('')
                    .trim()
                    .max(128 * 1024),
                html: Joi.string()
                    .allow('')
                    .trim()
                    .max(128 * 1024),
                start: Joi.date().empty('').allow(false),
                end: Joi.date().empty('').allow(false),
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
                req.validate(roles.can(req.role).updateOwn('autoreplies'));
            } else {
                req.validate(roles.can(req.role).updateAny('autoreplies'));
            }

            let user = new ObjectID(result.value.user);
            result.value.user = user;

            if (typeof result.value.status === 'boolean') {
                const r = await db.users.collection('users').updateOne({ _id: user }, { $set: { autoreply: result.value.status } });
                if (!r.matchedCount) {
                    res.json({
                        error: 'Unknown user',
                        code: 'UserNotFound'
                    });
                    return next();
                }
                if (r.modifiedCount) {
                    await publish(db.redis, {
                        ev: result.value.status ? AUTOREPLY_USER_ENABLED : AUTOREPLY_USER_DISABLED,
                        user
                    });
                }
            } else {
                const userData = await db.users.collection('users').findOne({ _id: user }, { projection: { _id: true, autoreply: true } });
                if (!userData) {
                    res.json({
                        error: 'Unknown user',
                        code: 'UserNotFound'
                    });
                    return next();
                }
            }

            const r = await db.database.collection('autoreplies').updateOne({ user }, { $set: result.value }, { upsert: true });

            res.json({
                success: true,
                id: r.upsertedId && r.upsertedId._id
            });

            return next();
        })
    );

    /**
     * @api {get} /users/:user/autoreply Request Autoreply information
     * @apiName GetAutoreply
     * @apiGroup Autoreplies
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Boolean} status Is the autoreply enabled (true) or not (false)
     * @apiSuccess {String} name Name that is used for the From: header in autoreply message
     * @apiSuccess {String} subject Subject line for the autoreply. If empty then uses subject of the original message
     * @apiSuccess {String} html HTML formatted content of the autoreply message
     * @apiSuccess {String} text Plaintext formatted content of the autoreply message
     * @apiSuccess {String} start Datestring of the start of the autoreply
     * @apiSuccess {String} end Datestring of the end of the autoreply
     *
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i http://localhost:8080/users/59fc66a03e54454869460e45/autoreply
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "status": true,
     *       "subject": "",
     *       "text": "Away from office until Dec.19",
     *       "html": "",
     *       "start": "2017-11-15T00:00:00.000Z",
     *       "end": "2017-12-19T00:00:00.000Z"
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.get(
        '/users/:user/autoreply',
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
                req.validate(roles.can(req.role).readOwn('autoreplies'));
            } else {
                req.validate(roles.can(req.role).readAny('autoreplies'));
            }

            let user = new ObjectID(result.value.user);

            let entry = await db.database.collection('autoreplies').findOne({ user });

            entry = entry || {};
            res.json({
                success: true,
                status: !!entry.status,
                name: entry.name || '',
                subject: entry.subject || '',
                text: entry.text || '',
                html: entry.html || '',
                start: entry.start || false,
                end: entry.end || false
            });

            return next();
        })
    );

    /**
     * @api {delete} /users/:user/autoreply Delete Autoreply information
     * @apiName DeleteAutoreply
     * @apiGroup Autoreplies
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user ID of the User
     *
     * @apiSuccess {Boolean} success Indicates successful response
     *
     * @apiError error Description of the error
     *
     * @apiExample {curl} Example usage:
     *     curl -i -XDELETE http://localhost:8080/users/59fc66a03e54454869460e45/autoreply
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
     *       "error": "This user does not exist"
     *     }
     */
    server.del(
        '/users/:user/autoreply',
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
                req.validate(roles.can(req.role).deleteOwn('autoreplies'));
            } else {
                req.validate(roles.can(req.role).deleteAny('autoreplies'));
            }

            let user = new ObjectID(result.value.user);

            let r = await db.users.collection('users').updateOne({ _id: user }, { $set: { autoreply: false } });
            if (r.modifiedCount) {
                await publish(db.redis, {
                    ev: AUTOREPLY_USER_DISABLED,
                    user
                });
            }

            await db.database.collection('autoreplies').deleteOne({ user });

            res.json({
                success: true
            });

            return next();
        })
    );
};
