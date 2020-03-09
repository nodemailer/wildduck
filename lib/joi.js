'use strict';

const EJSON = require('mongodb-extended-json');
const Joi = require('@hapi/joi');

const customJoi = Joi.extend(joi => {
    return {
        type: 'mongoCursor',
        base: joi.string(),
        messages: {
            'mongoCursor.base64': '"{{#label}}" needs to be a base64 URL',
            'mongoCursor.ejson': '"{{#label}}" needs to be an extended JSON object'
        },
        validate(value, helpers) {
            if (/[^a-zA-Z0-9\-_]/.test(value)) {
                return { value, errors: helpers.error('mongoCursor.base64') };
            }
            try {
                EJSON.parse(Buffer.from(value, 'base64'));
            } catch (E) {
                return { value, errors: helpers.error('mongoCursor.ejson') };
            }
        }
    };
});

module.exports = customJoi;
