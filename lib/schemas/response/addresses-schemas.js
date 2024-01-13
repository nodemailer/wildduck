'use strict';

const Joi = require('joi');
const { booleanSchema } = require('../../schemas');

const GetAddressesResult = Joi.object({
    id: Joi.string().required().description('ID of the Address'),
    name: Joi.string().required().description('Identity name'),
    address: Joi.string().required().description('E-mail address string'),
    user: Joi.string().required().description('User ID this address belongs to if this is a User address'),
    forwarded: booleanSchema.required().description('If true then it is a forwarded address'),
    forwardedDisabled: booleanSchema.required().description('If true then the forwarded address is disabled'),
    target: Joi.array().items(Joi.string()).description('List of forwarding targets')
}).$_setFlag('objectName', 'GetAddressesResult');

module.exports = { GetAddressesResult };
