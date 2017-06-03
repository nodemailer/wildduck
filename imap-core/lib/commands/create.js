'use strict';

const imapTools = require('../imap-tools');
const utf7 = require('utf7').imap;

// tag CREATE "mailbox"

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [
        {
            name: 'mailbox',
            type: 'string'
        }
    ],

    handler(command, callback) {
        let mailbox = Buffer.from((command.attributes[0] && command.attributes[0].value) || '', 'binary').toString();

        if (!this.acceptUTF8Enabled) {
            // decode before normalizing to uncover stuff like ending / etc.
            mailbox = utf7.decode(mailbox);
        }

        // Check if CREATE method is set
        if (typeof this._server.onCreate !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'CREATE not implemented'
            });
        }

        if (!mailbox) {
            // nothing to check for if mailbox is not defined
            return callback(null, {
                response: 'NO',
                code: 'CANNOT',
                message: 'No folder name given'
            });
        }

        // ignore commands that try to create hierarchy
        if (/\/$/.test(mailbox)) {
            return callback(null, {
                response: 'OK',
                code: 'CANNOT',
                message: 'Ignoring hierarchy declaration'
            });
        }

        // ignore commands with adjacent spaces
        if (/\/{2,}/.test(mailbox)) {
            return callback(null, {
                response: 'NO',
                code: 'CANNOT',
                message: 'Adjacent hierarchy separators are not supported'
            });
        }

        mailbox = imapTools.normalizeMailbox(mailbox);

        this._server.onCreate(mailbox, this.session, (err, success) => {
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
