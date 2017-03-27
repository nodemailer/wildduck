'use strict';

let imapHandler = require('../handler/imap-handler');
let imapTools = require('../imap-tools');
let utf7 = require('utf7').imap;

// tag SELECT "mailbox"
// tag EXAMINE "mailbox"

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [{
        name: 'mailbox',
        type: 'string'
    }],

    handler(command, callback) {

        let path = Buffer.from(command.attributes[0] && command.attributes[0].value || '', 'binary').toString();
        let mailbox = imapTools.normalizeMailbox(path, !this.acceptUTF8Enabled);

        if (typeof this._server.onGetQuota !== 'function') {
            return callback(null, {
                response: 'NO',
                message: command.command + ' not implemented'
            });
        }

        if (!mailbox) {
            // nothing to check for if mailbox is not defined
            return callback(null, {
                response: 'NO',
                code: 'NONEXISTENT'
            });
        }

        this._server.onGetQuotaRoot(mailbox, this.session, (err, data) => {
            if (err) {
                return callback(err);
            }

            if (typeof data === 'string') {
                return callback(null, {
                    response: 'NO',
                    code: data.toUpperCase()
                });
            }

            if (!this.acceptUTF8Enabled) {
                path = utf7.encode(path);
            } else {
                path = Buffer.from(path);
            }

            // * QUOTAROOT INBOX ""
            this.send(imapHandler.compiler({
                tag: '*',
                command: 'QUOTAROOT',
                attributes: [path, data.root || '']
            }));

            // * QUOTA "" (STORAGE 220676 15728640)
            this.send(imapHandler.compiler({
                tag: '*',
                command: 'QUOTA',
                attributes: [data.root || '', [{
                    type: 'atom',
                    value: 'STORAGE'
                }, {
                    type: 'atom',
                    value: String(Math.ceil((Number(data.storageUsed) || 0) / 1024))
                }, {
                    type: 'atom',
                    value: String(Math.ceil((Number(data.quota) || 0) / 1024))
                }]]
            }));

            callback(null, {
                response: 'OK',
                message: 'Success'
            });
        });
    }
};
