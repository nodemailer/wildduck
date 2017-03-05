'use strict';

let imapTools = require('../imap-tools');

// tag RENAME "mailbox"

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [{
        name: 'mailbox',
        type: 'string'
    }, {
        name: 'newname',
        type: 'string'
    }],

    handler(command, callback) {

        let mailbox = command.attributes[0] && command.attributes[0].value || '';
        let newname = command.attributes[1] && command.attributes[1].value || '';

        // Check if RENAME method is set
        if (typeof this._server.onRename !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'RENAME not implemented'
            });
        }

        if (!mailbox || !newname) {
            // nothing to check for if mailbox is not defined
            return callback(null, {
                response: 'NO',
                code: 'CANNOT',
                message: 'No folder name given'
            });
        }

        // ignore commands with adjacent spaces
        if (/\/{2,}/.test(newname)) {
            return callback(null, {
                response: 'NO',
                code: 'CANNOT',
                message: 'Adjacent hierarchy separators are not supported'
            });
        }

        mailbox = imapTools.normalizeMailbox(mailbox);
        newname = imapTools.normalizeMailbox(newname);

        // Renaming INBOX is permitted by RFC3501 but not by this implementation
        if (mailbox === 'INBOX') {
            return callback(null, {
                response: 'NO',
                code: 'CANNOT',
                message: 'INBOX can not be renamed'
            });
        }

        if (newname === 'INBOX') {
            return callback(null, {
                response: 'NO',
                code: 'ALREADYEXISTS',
                message: 'INBOX already exists'
            });
        }

        this._server.onRename(mailbox, newname, this.session, (err, success) => {
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
