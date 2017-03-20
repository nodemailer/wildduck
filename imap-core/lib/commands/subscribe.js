'use strict';

let imapTools = require('../imap-tools');

// tag SUBSCRIBE "mailbox"

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [{
        name: 'mailbox',
        type: 'string'
    }],

    handler(command, callback) {

        let path = Buffer.from(command.attributes[0] && command.attributes[0].value || '', 'binary').toString();
        let mailbox = imapTools.normalizeMailbox(path, !this.acceptUTF8Enabled);

        // Check if SUBSCRIBE method is set
        if (typeof this._server.onSubscribe !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'SUBSCRIBE not implemented'
            });
        }

        if (!mailbox) {
            // nothing to check for if mailbox is not defined
            return callback(null, {
                response: 'NO',
                code: 'NONEXISTENT'
            });
        }

        if (mailbox === 'INBOX') {
            return callback(null, {
                response: 'OK'
            });
        }

        this._server.onSubscribe(mailbox, this.session, (err, success) => {
            if (err) {
                return callback(err);
            }

            callback(null, {
                response: success === true ? 'OK' : 'NO',
                code: typeof success === 'string' ? success.toUpperCase() : false
            });

        });

    }
};
