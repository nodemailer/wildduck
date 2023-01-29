'use strict';

const log = require('npmlog');
const Joi = require('joi');
const tools = require('../tools');
const roles = require('../roles');
const mboxExport = require('../mbox-export');
const ObjectId = require('mongodb').ObjectId;
const { sessSchema, sessIPSchema } = require('../schemas');

module.exports = (db, server, auditHandler) => {
    server.post(
        '/audit',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),
                start: Joi.date().empty('').allow(false),
                end: Joi.date().empty('').allow(false),
                expires: Joi.date().empty('').greater('now').required(),
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
            req.validate(roles.can(req.role).updateAny('audit'));

            let user = new ObjectId(result.value.user);
            let start = result.value.start;
            let end = result.value.end;
            let expires = result.value.expires;

            let audit = await auditHandler.create({
                user,
                start,
                end,
                expires
            });

            return res.json({
                success: true,
                id: audit
            });
        })
    );

    server.get(
        '/audit/:audit',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                audit: Joi.string().hex().lowercase().length(24).required()
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
            req.validate(roles.can(req.role).readAny('audit'));

            let auditData = await db.database.collection('audits').findOne({ _id: new ObjectId(req.params.audit) });
            if (!auditData) {
                res.status(404);
                return res.json({
                    error: 'Audit not found',
                    code: 'AuditNotFoundError'
                });
            }

            res.status(200);
            return res.json({
                success: true,
                id: auditData._id.toString(),
                user: auditData.user,
                start: auditData.start && auditData.start.toISOString(),
                end: auditData.end && auditData.end.toISOString(),
                expires: auditData.expires && auditData.expires.toISOString(),
                import: auditData.import
            });
        })
    );

    server.get(
        '/audit/:audit/export.mbox',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                audit: Joi.string().hex().lowercase().length(24).required()
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
            req.validate(roles.can(req.role).readAny('audit'));

            let output = await mboxExport(auditHandler, new ObjectId(req.params.audit));
            if (!output) {
                res.status(404);
                return res.json({
                    error: 'Audit not found',
                    code: 'AuditNotFoundError'
                });
            }

            res.setHeader('Content-Type', 'application/octet-stream');
            res.setHeader('Content-Dispositon', 'attachment; filename=export.mbox');

            output.on('error', err => {
                log.error('Audit', `Failed processing audit ${req.params.audit}: ${err.message}`);
                try {
                    res.end();
                } catch (err) {
                    //ignore
                }
            });

            output.pipe(res);
        })
    );
};
