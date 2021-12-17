/* eslint no-control-regex: 0 */

'use strict';

const EJSON = require('mongodb-extended-json');
const Joi = require('joi');

const invertedAddressRegex = /\*|^\.|\.$|\.{2,}|\.@|@\.|[\x00-\x20\x7f-\xff]/;

const sessSchema = Joi.string().max(256).label('SessionIdentifier').description('Session identifier').example('62a173d53d4048599f85c2e0');
const sessIPSchema = Joi.string()
    .ip({
        version: ['ipv4', 'ipv6'],
        cidr: 'forbidden'
    })
    .label('ClientIP')
    .description('Client IP')
    .example('127.0.0.1');

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

const tagListFilter = () => list => {
    let seen = new Set();

    list = Array.from(
        new Set(
            list
                .map(tag => tag.trim())
                .filter(tag => {
                    if (!tag) {
                        return false;
                    }
                    let lTag = tag.toLowerCase();
                    if (seen.has(lTag)) {
                        return false;
                    }
                    seen.add(lTag);
                    return tag;
                })
        )
    ).sort((a, b) => a.localeCompare(b));

    return list;
};

const tagsArraySchema = Joi.array().items(Joi.string().max(256)).max(256).custom(tagListFilter({}));

const tagValueValidator = () => value => {
    let list;

    if (typeof value === 'string') {
        list = value.split(',');
    }

    const { error: strError, value: processedValue } = tagsArraySchema.validate(list);
    if (strError) {
        throw strError;
    }

    return processedValue.join(',');
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
const pageLimitSchema = Joi.number().default(20).min(1).max(250).label('Page size').description('How many records to return').example(20);
const pageNrSchema = Joi.number()
    .default(1)
    .label('Page number')
    .description('Current page number. Informational only, page numbers start from 1')
    .example(123);
const nextPageCursorSchema = mongoCursorSchema
    .label('Next page cursor')
    .description('Cursor value for next page, retrieved from nextCursor response value')
    .example('W3siJGRhdGUiOiIyMDIxLTEx....');
const previousPageCursorSchema = mongoCursorSchema
    .label('Previous page cursor')
    .description('Cursor value for previous page, retrieved from previousCursor response value')
    .example('W3siJGRhdGUiOiIyMDIxLTEx....');

const booleanSchema = Joi.boolean().empty('').truthy('Y', 'true', 'yes', 'on', '1', 1).falsy('N', 'false', 'no', 'off', '0', 0);
const metaDataSchema = Joi.any().custom(metaDataValidator({}), 'metadata validation');

const mongoIdSchema = Joi.string().hex().lowercase().length(24).example('613b069b9a6cbad5ba18d552');
const userIdSchema = mongoIdSchema.example('5ea82073daa6540db24dece6').label('UserID').description('User ID');

const tagsSchema = Joi.string().custom(tagValueValidator({}));

const userNameSchema = Joi.string().max(256).example('John Smith').description('Name of the user');

const forwardTargetSchema = Joi.array()
    .items(
        Joi.string().email({ tlds: false }),
        Joi.string().uri({
            scheme: [/smtps?/, /https?/],
            allowRelative: false,
            relativeOnly: false
        })
    )
    .example(['user@example.com', 'https://example.com/upload/email'])
    .description('A list of forwarding targets, either email addresses or URLs');

const userUsernameSchema = Joi.string()
    .lowercase()

    // only a single regex() per schema allowed
    .regex(invertedAddressRegex, { name: 'username', invert: true })

    .min(1)
    .max(128)
    .example('myuser2')
    .description('Username');

module.exports = {
    sessSchema,
    sessIPSchema,
    pageNrSchema,
    nextPageCursorSchema,
    previousPageCursorSchema,
    pageLimitSchema,
    booleanSchema,
    metaDataSchema,
    userNameSchema,
    userUsernameSchema,
    userIdSchema,
    mongoIdSchema,
    tagsSchema,
    tagsArraySchema,
    forwardTargetSchema,
    invertedAddressRegex
};
