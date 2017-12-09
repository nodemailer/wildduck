'use strict';

const imapTools = require('../imap-tools');

// tag DELETE "mailbox"

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [
        {
            name: 'path',
            type: 'string'
        }
    ],

    handler(command, callback) {
        let path = Buffer.from((command.attributes[0] && command.attributes[0].value) || '', 'binary').toString();
        path = imapTools.normalizeMailbox(path, !this.acceptUTF8Enabled);

        // Check if DELETE method is set
        if (typeof this._server.onDelete !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'DELETE not implemented'
            });
        }

        if (!path) {
            // nothing to check for if mailbox is not defined
            return callback(null, {
                response: 'NO',
                code: 'CANNOT',
                message: 'No folder name given'
            });
        }

        if (path === 'INBOX') {
            // nothing to check for if mailbox is not defined
            return callback(null, {
                response: 'NO',
                code: 'CANNOT',
                message: 'INBOX can not be deleted'
            });
        }

        this._server.onDelete(path, this.session, (err, success) => {
            if (err) {
                return callback(err);
            }

            if (success !== true) {
                return callback(null, {
                    response: 'NO',
                    code: typeof success === 'string' ? success.toUpperCase() : false
                });
            }

            callback(null, {
                response: 'OK'
            });
        });
    }
};
