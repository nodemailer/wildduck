'use strict';

const EJSON = require('mongodb-extended-json');
const Joi = require('@hapi/joi');
const customJoi = Joi.extend(joi => ({
    base: joi.string(),
    type: 'string',
    validate(value, helpers) {
        if (helpers.prefs.convert && this._flags.round) {
            return Math.round(value); // Change the value
        }
        return value; // Keep the value as it was
    },
    rules: {
        mongoCursor: {
            alias: 'mongoCursor',
            validate(value, helpers, args, options) {
                if (/[^a-zA-Z0-9\-_]/.test(value)) {
                    return Joi.$_createError('string.base64url', value, helpers, undefined, helpers.prefs, options);
                }
                try {
                    EJSON.parse(Buffer.from(value, 'base64'));
                } catch (E) {
                    return Joi.$_createError('string.ejson', value, helpers, undefined, helpers.prefs, options);
                    // What are these arguments? The documentation doesn't say much. Someone pliss help
                }

                return value; // Everything is OK
            }
        }
    }
}));

module.exports = customJoi;
