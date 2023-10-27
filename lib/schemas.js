'use strict';

const EJSON = require('mongodb-extended-json');
const Joi = require('joi');

const sessSchema = Joi.string().max(255).label('Session identifier').description('Session identifier for the logs');
const sessIPSchema = Joi.string()
    .ip({
        version: ['ipv4', 'ipv6'],
        cidr: 'forbidden'
    })
    .label('Client IP')
    .description('IP address for the logs ');

/*
const tagSchema = Joi.string().max();
const tagStringValidator = () => {
    return value => {
        let tagSeen = new Set();
        let tags = ((value && value.toString()) || '')
            .split(',')
            .map(tag => tag.toLowerCase().trim())
            .filter(tag => {
                if (tag && !tagSeen.has(tag)) {
                    tagSeen.add(tag);
                    return true;
                }
                return false;
            });

        return tags;
    };
};
*/

const mongoCursorValidator = () => (value, helpers) => {
    value = value.toString();

    if (/[^a-zA-Z0-9\-_]/.test(value)) {
        return helpers.error('any.invalid');
    }
    try {
        EJSON.parse(Buffer.from(value, 'base64'));
    } catch (E) {
        return helpers.error('any.invalid');
    }

    return value; // Everything is OK
};

const metaDataValidator = () => (value, helpers) => {
    let parsed;

    if (typeof value === 'object') {
        try {
            parsed = value;
            value = JSON.stringify(value);
        } catch (err) {
            return helpers.error('any.invalid');
        }
    } else {
        try {
            parsed = JSON.parse(value);
        } catch (err) {
            return helpers.error('any.invalid');
        }
    }

    const { error: strError, value: strValue } = Joi.string()
        .trim()
        .max(1024 * 1024)
        .validate(value);
    if (strError) {
        throw strError;
    }

    const { error: objError } = Joi.object().validate(parsed);
    if (objError) {
        throw objError;
    }

    return strValue;
};

const mongoCursorSchema = Joi.string().trim().empty('').custom(mongoCursorValidator({}), 'Cursor validation').max(1024);
const pageLimitSchema = Joi.number().default(20).min(1).max(250).label('Page size');
const pageNrSchema = Joi.number().default(1).label('Page number').description('Current page number. Informational only, page numbers start from 1');
const nextPageCursorSchema = mongoCursorSchema.label('Next page cursor').description('Cursor value for next page, retrieved from nextCursor response value');
const previousPageCursorSchema = mongoCursorSchema
    .label('Previous page cursor')
    .description('Cursor value for previous page, retrieved from previousCursor response value');
const booleanSchema = Joi.boolean().empty('').truthy('Y', 'true', 'yes', 'on', '1', 1).falsy('N', 'false', 'no', 'off', '0', 0);
const metaDataSchema = Joi.any().custom(metaDataValidator({}), 'metadata validation');

const usernameSchema = Joi.string()
    .lowercase()
    .regex(/^[a-z0-9-]+(?:[._=:][a-z0-9-]+)*(?:@[a-z0-9-]+(?:[._=:][a-z0-9-]+)*)?$/, 'username')
    .min(1)
    .max(128);

module.exports = {
    sessSchema,
    sessIPSchema,
    pageNrSchema,
    nextPageCursorSchema,
    previousPageCursorSchema,
    pageLimitSchema,
    booleanSchema,
    metaDataSchema,
    usernameSchema
};
