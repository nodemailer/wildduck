'use strict';

const Joi = require('joi');
const { booleanSchema } = require('../../schemas');
const { addressId, addressEmail } = require('../request/general-schemas');

const GetAddressesResult = Joi.object({
    id: Joi.string().required().description('ID of the Address'),
    name: Joi.string().required().description('Identity name'),
    address: Joi.string().required().description('E-mail address string'),
    user: Joi.string().required().description('User ID this address belongs to if this is a User address'),
    forwarded: booleanSchema.required().description('If true then it is a forwarded address'),
    forwardedDisabled: booleanSchema.required().description('If true then the forwarded address is disabled'),
    target: Joi.array().items(Joi.string()).description('List of forwarding targets')
}).$_setFlag('objectName', 'GetAddressesResult');

const GetUserAddressesResult = Joi.object({
    id: addressId,
    name: Joi.string().required().description('Identity name'),
    address: addressEmail,
    main: booleanSchema.required().description('Indicates if this is the default address for the User'),
    created: Joi.date().required().description('Datestring of the time the address was created'),
    tags: Joi.array().items(Joi.string()).required().description('List of tags associated with the Address'),
    metaData: Joi.object({}).description('Metadata object (if available)'),
    internalData: Joi.object({}).description('Internal metadata object (if available), not included for user-role requests')
}).$_setFlag('objectName', 'GetUserAddressesResult');

const GetUserAddressesregisterResult = Joi.object({
    id: addressId,
    name: Joi.string().description('Name from address header'),
    address: addressEmail
}).$_setFlag('objectName', 'GetUserAddressesregisterResult');

module.exports = { GetAddressesResult, GetUserAddressesResult, GetUserAddressesregisterResult };
