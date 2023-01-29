'use strict';

const Joi = require('joi');
const ObjectId = require('mongodb').ObjectId;
const tools = require('../tools');
const roles = require('../roles');
const { sessSchema, sessIPSchema } = require('../schemas');

module.exports = (db, server) => {
    server.post(
        '/domainaccess/:tag/:action',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                        returnDocument: 'after'
                    }
                );
            } catch (err) {
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            return res.json({
                success: !!(r && r.value),
                id: ((r && r.value && r.value._id) || '').toString()
            });
        })
    );

    server.get(
        '/domainaccess/:tag/:action',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
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
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            if (!domains) {
                domains = [];
            }

            return res.json({
                success: true,
                results: domains.map(domainData => ({
                    id: domainData._id.toString(),
                    domain: domainData.domain,
                    action
                }))
            });
        })
    );

    server.del(
        '/domainaccess/:domain',
        tools.responseWrapper(async (req, res) => {
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
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
            }

            // permissions check
            req.validate(roles.can(req.role).deleteAny('domainaccess'));

            let domain = new ObjectId(result.value.domain);

            let r;

            try {
                r = await db.database.collection('domainaccess').deleteOne({
                    _id: domain
                });
            } catch (err) {
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            if (!r.deletedCount) {
                res.status(404);
                return res.json({
                    error: 'Domain was not found',
                    code: 'DomainNotFound'
                });
            }

            return res.json({
                success: true,
                deleted: domain
            });
        })
    );
};
