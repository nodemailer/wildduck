'use strict';
const Joi = require('joi');

const Rcpt = Joi.object({
    value: Joi.string().required().description('RCPT TO address as provided by SMTP client'),
    formatted: Joi.string().required().description('Normalized RCPT address')
}).$_setFlag('objectName', 'Rcpt');

const MsgEnvelope = Joi.object({
    from: Joi.string().required().description('Address from MAIL FROM'),
    rcpt: Joi.array().items(Rcpt).description('Array of addresses from RCPT TO (should have just one normally)')
})
    .description('SMTP envelope (if available)')
    .$_setFlag('objectName', 'Envelope');

module.exports = {
    MsgEnvelope
};
