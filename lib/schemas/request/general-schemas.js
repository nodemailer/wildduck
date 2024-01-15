'use strict';

const Joi = require('joi');

const userId = Joi.string().hex().lowercase().length(24).required().description('ID of the User');
const mailboxId = Joi.string().hex().lowercase().length(24).required().description('ID of the Mailbox');
const messageId = Joi.number().min(1).required().description('Message ID');
const addressEmail = Joi.string().email({ tlds: false }).required().description('E-mail Address');
const addressId = Joi.string().hex().lowercase().length(24).required().description('ID of the Address');

module.exports = {
    userId,
    mailboxId,
    messageId,
    addressEmail,
    addressId
};
