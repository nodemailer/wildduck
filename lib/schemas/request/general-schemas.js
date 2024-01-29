'use strict';

const Joi = require('joi');

const userId = Joi.string().hex().lowercase().length(24).required().description('Example: `507f1f77bcf86cd799439011`\nID of the User');
const mailboxId = Joi.string().hex().lowercase().length(24).required().description('ID of the Mailbox');
const messageId = Joi.number().min(1).required().description('Message ID');
const addressEmail = Joi.string().email({ tlds: false }).required().description('E-mail Address');
const addressId = Joi.string().hex().lowercase().length(24).required().description('ID of the Address');
const filterId = Joi.string().hex().lowercase().length(24).required().description('Filters unique ID');

module.exports = {
    userId,
    mailboxId,
    messageId,
    addressEmail,
    addressId,
    filterId
};
