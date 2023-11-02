'use strict';

const Joi = require('joi');

const userId = Joi.string().hex().lowercase().length(24).required().description('ID of the User');
const mailboxId = Joi.string().hex().lowercase().length(24).required().description('ID of the Mailbox');
const messageId = Joi.number().min(1).required().description('Message ID');
module.exports = {
    userId,
    mailboxId,
    messageId
};
