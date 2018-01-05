'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

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
    server.put('/users/:user/autoreply', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            status: Joi.boolean()
                .truthy(['Y', 'true', 'yes', 1])
                .default(false),
            subject: Joi.string()
                .empty('')
                .trim()
                .max(128),
            text: Joi.string()
                .empty('')
                .trim()
                .max(128 * 1024),
            html: Joi.string()
                .empty('')
                .trim()
                .max(128 * 1024),
            start: Joi.date()
                .empty('')
                .allow(false),
            end: Joi.date()
                .empty('')
                .allow(false)
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

        if (!result.value.subject && 'subject' in req.params) {
            result.value.subject = '';
        }

        if (!result.value.text && 'text' in req.params) {
            result.value.text = '';
            if (!result.value.html) {
                // make sure we also update html part
                result.value.html = '';
            }
        }

        if (!result.value.html && 'html' in req.params) {
            result.value.html = '';
            if (!result.value.text) {
                // make sure we also update plaintext part
                result.value.text = '';
            }
        }

        let user = (result.value.user = new ObjectID(result.value.user));
        db.users.collection('users').updateOne({ _id: user }, { $set: { autoreply: result.value.status } }, (err, r) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }
            if (!r.matchedCount) {
                res.json({
                    error: 'Unknown user'
                });
                return next();
            }

            db.database.collection('autoreplies').updateOne({ user }, { $set: result.value }, { upsert: true }, (err, r) => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                res.json({
                    success: true,
                    id: r.insertedId
                });

                return next();
            });
        });
    });

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
    server.get('/users/:user/autoreply', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required()
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

        db.database.collection('autoreplies').findOne({ user }, (err, entry) => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            entry = entry || {};
            res.json({
                success: true,
                status: !!entry.status,
                subject: entry.subject || '',
                text: entry.text || '',
                html: entry.html || '',
                start: entry.start,
                end: entry.end
            });

            return next();
        });
    });

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
    server.del('/users/:user/autoreply', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required()
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

        db.users.collection('users').updateOne({ _id: user }, { $set: { autoreply: false } }, err => {
            if (err) {
                res.json({
                    error: err.message
                });
                return next();
            }

            db.database.collection('autoreplies').deleteOne({ user }, err => {
                if (err) {
                    res.json({
                        error: err.message
                    });
                    return next();
                }

                res.json({
                    success: true
                });

                return next();
            });
        });
    });
};
