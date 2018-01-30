'use strict';

// TODO: handle drafts

/*

{
    _id: "aaaaa",
    user: "bbbbb",

    reference: 'message_id',
    action: 'reply',
    references: ['from-ref-message'],
    inReplyTo: ['from-ref-message'],

    messageId: '<draft.id@local>',
    date: date_obj,

    from: identity_ref,
    to: [{name, address}],
    cc: [{name, address}],
    bcc: [{name, address}],

    subject: 'test',
    html: '<html>',

    attachments: [
        {
            filename: 'aaa.jpg',
            contentType: 'image/jpeg',
            content: binary,
            cid: 'only.for@embedded.images'
        }
    ]
}

 */

class DraftHandler {
    constructor(options) {
        this.database = options.database;
        this.redis = options.redis;
    }

    // should create a new Draft object and return ID
    create(user, options, callback) {
        options = options || {};
        callback(new Error('Future feature'));
    }

    // should retrieve draft info
    get(user, draft, callback) {
        callback(new Error('Future feature'));
    }

    // should add new attachment to draft and return attachment ID
    addAttachment(user, draft, attachmentData, callback) {
        callback(new Error('Future feature'));
    }

    // should delete an attachment from a draft
    deleteAttachment(user, draft, attachment, callback) {
        callback(new Error('Future feature'));
    }

    // should submit message to queue and delete draft
    send(user, draft, envelope, callback) {
        callback(new Error('Future feature'));
    }

    // should cancel the draft and delete contents
    discard(user, draft, callback) {
        callback(new Error('Future feature'));
    }
}

module.exports = DraftHandler;
