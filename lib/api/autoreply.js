'use strict';

const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;

module.exports = (db, server) => {
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
            start: Joi.date(),
            end: Joi.date().min(Joi.ref('start'))
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
                error: result.error.message
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
                error: result.error.message
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
