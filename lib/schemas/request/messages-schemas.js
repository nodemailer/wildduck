'use strict';

const Joi = require('joi');
const { booleanSchema } = require('../../schemas');

const Address = Joi.object({
    name: Joi.string().empty('').max(255),
    address: Joi.string().email({ tlds: false }).required()
}).$_setFlag('objectName', 'Address');

const AddressOptionalName = Joi.object({
    name: Joi.string().empty('').max(255),
    address: Joi.string().email({ tlds: false }).required()
}).$_setFlag('objectName', 'AddressOptionalName');

const AddressOptionalNameArray = Joi.array().items(AddressOptionalName);

const Header = Joi.object({
    key: Joi.string().empty('').max(255),
    value: Joi.string()
        .empty('')
        .max(100 * 1024)
}).$_setFlag('objectName', 'Header');

const Attachment = Joi.object({
    filename: Joi.string().empty('').max(255),
    contentType: Joi.string().empty('').max(255),
    encoding: Joi.string().empty('').default('base64'),
    contentTransferEncoding: Joi.string().empty(''),
    content: Joi.string().required(),
    cid: Joi.string().empty('').max(255)
}).$_setFlag('objectName', 'Attachment');

const ReferenceWithAttachments = Joi.object({
    mailbox: Joi.string().hex().lowercase().length(24).required(),
    id: Joi.number().required(),
    action: Joi.string().valid('reply', 'replyAll', 'forward').required(),
    attachments: Joi.alternatives().try(
        booleanSchema,
        Joi.array().items(
            Joi.string()
                .regex(/^ATT\d+$/i)
                .uppercase()
        )
    )
}).$_setFlag('objectName', 'ReferenceWithAttachments');

const Bimi = Joi.object({
    domain: Joi.string().domain().required(),
    selector: Joi.string().empty('').max(255)
}).$_setFlag('objectName', 'Bimi');

module.exports = {
    Address,
    AddressOptionalNameArray,
    Header,
    Attachment,
    ReferenceWithAttachments,
    Bimi
};
