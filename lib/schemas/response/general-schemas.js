'use strict';

const Joi = require('joi');
const { booleanSchema } = require('../../schemas');

const successRes = booleanSchema.required().description('Indicates successful response');
const totalRes = Joi.number().required().description('How many results were found');
const pageRes = Joi.number().required().description('Current page number. Derived from page query argument');
const previousCursorRes = Joi.alternatives()
    .try(Joi.string(), booleanSchema)
    .required()
    .description('Either a cursor string or false if there are not any previous results');
const nextCursorRes = Joi.alternatives()
    .try(Joi.string(), booleanSchema)
    .required()
    .description('Either a cursor string or false if there are not any next results');

const quotaRes = Joi.object({
    allowed: Joi.number().required().description('Allowed quota of the user in bytes'),
    used: Joi.number().required().description('Space used in bytes')
})
    .$_setFlag('objectName', 'Quota')
    .description('Quota usage limits');

module.exports = {
    successRes,
    totalRes,
    pageRes,
    previousCursorRes,
    nextCursorRes,
    quotaRes
};
