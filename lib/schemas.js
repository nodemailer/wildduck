'use strict';

const EJSON = require('mongodb-extended-json');
const Joi = require('@hapi/joi');

const sessSchema = Joi.string().max(255).label('Session identifier');

const sessIPSchema = Joi.string()
    .ip({
        version: ['ipv4', 'ipv6'],
        cidr: 'forbidden'
    })
    .label('Client IP');

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

const mongoCursorValidator = () => {
    return (value, helpers) => {
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
};

const tagStringSchema = Joi.any().empty('').custom(tagStringValidator({}), 'tag validation').array().items(Joi.string().max(128).label('Tag'));

const mongoCursorSchema = Joi.string().trim().lowercase().empty('').custom(mongoCursorValidator({}), 'Cursor validation').max(1024);
const pageLimitSchema = Joi.number().default(20).min(1).max(250).label('Page size');
const pageNrSchema = Joi.number().default(1).label('Page number');
const nextPageCursorSchema = mongoCursorSchema.label('Next page cursor');
const previousPageCursorSchema = mongoCursorSchema.label('Previous page cursor');

module.exports = { sessSchema, sessIPSchema, pageNrSchema, nextPageCursorSchema, previousPageCursorSchema, tagSchema, tagStringSchema, pageLimitSchema };
