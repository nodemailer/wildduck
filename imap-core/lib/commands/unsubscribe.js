'use strict';

let imapTools = require('../imap-tools');

// tag UNSUBSCRIBE "mailbox"

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [{
        name: 'mailbox',
        type: 'string'
    }],

    handler(command, callback) {

        let mailbox = imapTools.normalizeMailbox(command.attributes[0] && command.attributes[0].value || '', !this.acceptUTF8Enabled);

        // Check if UNSUBSCRIBE method is set
        if (typeof this._server.onUnsubscribe !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'UNSUBSCRIBE not implemented'
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
                response: 'NO',
                message: 'Can not unsubscribe from INBOX'
            });
        }

        this._server.onUnsubscribe(mailbox, this.session, (err, success) => {
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
