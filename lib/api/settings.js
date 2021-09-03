'use strict';

const Joi = require('joi');
const tools = require('../tools');
const roles = require('../roles');
const { sessSchema, sessIPSchema } = require('../schemas');
const { SettingsHandler } = require('../settings-handler');
const consts = require('../consts');

// allow overriding the following consts using the key format `const:archive:time`
const supportedDefaults = ['ARCHIVE_TIME'];

module.exports = (db, server) => {
    let settingsHandler = new SettingsHandler({ db: db.database });

    server.get(
        { name: 'settings', path: '/settings' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                prefix: Joi.string().empty('').max(128),
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            let permission = roles.can(req.role).readAny('settings');
            // permissions check
            req.validate(permission);

            let defaults = {};
            for (let defaultKey of supportedDefaults) {
                let constKey = `const:${defaultKey.toLowerCase().replace(/_/g, ':')}`;
                defaults[constKey] = consts[defaultKey];
            }

            let settings = await settingsHandler.list(result.value.prefix);

            let response = {
                success: true,
                prefix: result.value.prefix,
                settings: Object.assign(defaults, settings)
            };

            res.json(response);
            return next();
        })
    );

    server.put(
        '/settings/:key',
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                key: Joi.string().empty('').max(128).required(),
                value: Joi.any().allow('', 0, false).required(),
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
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: !!storedValue,
                key
            });
            return next();
        })
    );

    server.get(
        '/settings/:key',
        tools.asyncifyJson(async (req, res, next) => {
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
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError',
                    details: tools.validationErrors(result)
                });
                return next();
            }

            // permissions check
            let permission = roles.can(req.role).readAny('settings');
            req.validate(permission);

            let key = result.value.key;

            let defaultValue;
            if (/^const:/.test(key)) {
                // get default
                let constKey = key
                    .replace(/^const:/, '')
                    .replace(/:/g, '_')
                    .toUpperCase();

                if (supportedDefaults.includes(constKey) && consts.hasOwnProperty(constKey)) {
                    defaultValue = consts[constKey];
                }
            }

            let value;
            try {
                value = await settingsHandler.get(key, { default: defaultValue });
            } catch (err) {
                res.status(500);
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    code: 'InternalDatabaseError'
                });
                return next();
            }

            res.json({
                success: value !== undefined,
                key,
                value,
                error: value === undefined ? 'Key was not found' : undefined
            });

            return next();
        })
    );
};
