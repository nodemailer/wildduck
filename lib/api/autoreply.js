'use strict';

const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const roles = require('../roles');
const { sessSchema, sessIPSchema, booleanSchema } = require('../schemas');
const { publish, AUTOREPLY_USER_DISABLED, AUTOREPLY_USER_ENABLED } = require('../events');

module.exports = (db, server) => {
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

            let user = new ObjectId(result.value.user);
            result.value.user = user;

            if (typeof result.value.status === 'boolean') {
                const r = await db.users.collection('users').updateOne({ _id: user }, { $set: { autoreply: result.value.status } });
                if (!r.matchedCount) {
                    res.status(404);
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
                    res.status(404);
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
                id: ((r.upsertedId && r.upsertedId._id) || '').toString()
            });

            return next();
        })
    );

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

            let user = new ObjectId(result.value.user);

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

            let user = new ObjectId(result.value.user);

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
