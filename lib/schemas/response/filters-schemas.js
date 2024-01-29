'use strict';

const Joi = require('joi');
const { booleanSchema } = require('../../schemas');

const GetAllFiltersResult = Joi.object({
    id: Joi.string().required().description('Filter ID'),
    user: Joi.string().required().description('User ID'),
    name: Joi.string().required().description('Name for the filter'),
    created: Joi.date().required().description('Datestring of the time the filter was created'),
    query: Joi.array().items(Joi.array().items(Joi.string())).required().description('Filter query strings'),
    action: Joi.array().items(Joi.array().items(Joi.string())).required().description('Filter action strings'),
    disabled: booleanSchema.required().description('If true, then this filter is ignored'),
    metaData: Joi.object().description('Custom metadata value. Included if metaData query argument was true'),
    targets: Joi.array().items(Joi.string()).description('List of forwarding targets')
}).$_setFlag('objectName', 'GetAllFiltersResult');

const GetFiltersResult = Joi.object({
    id: Joi.string().required().description('Filter ID'),
    name: Joi.string().required().description('Name for the filter'),
    created: Joi.date().required().description('Datestring of the time the filter was created'),
    query: Joi.array().items(Joi.array().items(Joi.string())).required().description('Filter query strings'),
    action: Joi.array().items(Joi.array().items(Joi.string())).required().description('Filter action strings'),
    disabled: booleanSchema.required().description('If true, then this filter is ignored'),
    metaData: Joi.object().description('Custom metadata value. Included if metaData query argument was true')
}).$_setFlag('objectName', 'GetFiltersResult');

const ActionRes = Joi.object({
    seen: booleanSchema.description('If true then mark matching messages as Seen'),
    flag: booleanSchema.description('If true then mark matching messages as Flagged'),
    delete: booleanSchema.description('If true then do not store matching messages'),
    spam: booleanSchema.description('If true then store matching messags to Junk Mail folder'),
    mailbox: Joi.string().description('Mailbox ID to store matching messages to'),
    targets: Joi.array()
        .items(Joi.string())
        .description(
            'An array of forwarding targets. The value could either be an email address or a relay url to next MX server ("smtp://mx2.zone.eu:25") or an URL where mail contents are POSTed to'
        )
})
    .required()
    .description('Action to take with a matching message')
    .$_setFlag('objectName', 'Action');

const QueryRes = Joi.object({
    from: Joi.string().description('Partial match for the From: header (case insensitive)'),
    to: Joi.string().description('Partial match for the To:/Cc: headers (case insensitive)'),
    subject: Joi.string().description('Partial match for the Subject: header (case insensitive)'),
    listId: Joi.string().description('Partial match for the List-ID: header (case insensitive)'),
    text: Joi.string().description('Fulltext search against message text'),
    ha: booleanSchema.description('Does a message have to have an attachment or not'),
    size: Joi.number().description(
        'Message size in bytes. If the value is a positive number then message needs to be larger, if negative then message needs to be smaller than abs(size) value'
    )
})
    .required()
    .description('Rules that a message must match')
    .$_setFlag('objectName', 'Query');

module.exports = { GetAllFiltersResult, GetFiltersResult, ActionRes, QueryRes };
