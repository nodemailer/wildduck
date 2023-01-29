'use strict';

const Joi = require('joi');
const tools = require('../tools');
const roles = require('../roles');
const { sessSchema, sessIPSchema } = require('../schemas');

// allow overriding the following consts using the key format `const:archive:time`

module.exports = (db, server, settingsHandler) => {
    server.get(
        { name: 'settings', path: '/settings' },
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                filter: Joi.string().empty('').trim().max(128),
                sess: sessSchema,
                ip: sessIPSchema
            });

            const result = schema.validate(req.params, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.status(400);
                return res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
            }

            let permission = roles.can(req.role).readAny('settings');
            // permissions check
            req.validate(permission);

            let settings = await settingsHandler.list(result.value.filter);

            let response = {
                success: true,
                filter: result.value.filter,
                settings
            };

            return res.json(response);
        })
    );

    server.post(
        '/settings/:key',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                key: Joi.string()
                    .empty('')
                    .valid(...settingsHandler.keys.map(entry => entry.key))
                    .required(),
                value: Joi.any()
                    .when('key', {
                        switch: settingsHandler.keys.map(entry => ({
                            is: entry.key,
                            then: entry.schema
                        }))
                    })
                    .required(),
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
            let permission = roles.can(req.role).createAny('settings');
            req.validate(permission);

            result.value = permission.filter(result.value);

            let key = result.value.key;
            let value = result.value.value;

            let storedValue;
            try {
                storedValue = await settingsHandler.set(key, value);
            } catch (err) {
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            return res.json({
                success: !!storedValue,
                key
            });
        })
    );

    server.get(
        '/settings/:key',
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                key: Joi.string().empty('').max(128).required(),
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
            let permission = roles.can(req.role).readAny('settings');
            req.validate(permission);

            let key = result.value.key;

            let value;
            try {
                value = await settingsHandler.get(key, {});
            } catch (err) {
                res.status(500);
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
            }

            return res.json({
                success: value !== undefined,
                key,
                value,
                error: value === undefined ? 'Key was not found' : undefined
            });
        })
    );
};
