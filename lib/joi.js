'use strict';

const EJSON = require('mongodb-extended-json');
const Joi = require('joi');
const customJoi = Joi.extend(joi => ({
    base: joi.string(),
    name: 'string',
    language: {
        base64url: 'needs to be a base64 URL',
        ejson: 'needs to be an extended JSON object'
    },
    pre(value, state, options) {
        if (options.convert && this._flags.round) {
            return Math.round(value); // Change the value
        }
        return value; // Keep the value as it was
    },
    rules: [
        {
            name: 'mongoCursor',
            validate(params, value, state, options) {
                if (/[^a-zA-Z0-9\-_]/.test(value)) {
                    return this.createError('string.base64url', { v: value }, state, options);
                }
                try {
                    EJSON.parse(Buffer.from(value, 'base64'));
                } catch (E) {
                    return this.createError('string.ejson', { v: value }, state, options);
                }

                return value; // Everything is OK
            }
        }
    ]
}));

module.exports = customJoi;
