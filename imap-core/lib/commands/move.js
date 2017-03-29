'use strict';

let imapTools = require('../imap-tools');
let imapHandler = require('../handler/imap-handler');

module.exports = {
    state: 'Selected',

    schema: [{
        name: 'range',
        type: 'sequence'
    }, {
        name: 'mailbox',
        type: 'string'
    }],

    handler(command, callback) {

        let cmd = (command.command || '').toString().toUpperCase();

        // Check if MOVE method is set
        if (typeof this._server.onMove !== 'function') {
            return callback(null, {
                response: 'NO',
                message: cmd + ' not implemented'
            });
        }

        let range = command.attributes[0] && command.attributes[0].value || '';
        let path = Buffer.from(command.attributes[1] && command.attributes[1].value || '', 'binary').toString();
        let mailbox = imapTools.normalizeMailbox(path, !this.acceptUTF8Enabled);

        if (!mailbox) {
            return callback(new Error('Invalid mailbox argument for ' + cmd));
        }

        if (!imapTools.validateSequnce(range)) {
            return callback(new Error('Invalid sequence set for ' + cmd));
        }

        let messages = imapTools.getMessageRange(this.selected.uidList, range, cmd === 'UID MOVE');

        this._server.onMove(this.selected.mailbox, {
            destination: mailbox,
            messages
        }, this.session, (err, success, info) => {
            if (err) {
                return callback(err);
            }

            let code = typeof success === 'string' ? success.toUpperCase() : false;

            if (success === true) {
                this.send(imapHandler.compiler({
                    tag: '*',
                    command: 'OK',
                    attributes: [{
                        type: 'SECTION',
                        section: [{
                            type: 'TEXT',
                            value: 'COPYUID ' + info.uidValidity + ' ' + imapTools.packMessageRange(info.sourceUid) + ' ' + imapTools.packMessageRange(info.destinationUid)
                        }]
                    }]
                }));
            }

            callback(null, {
                response: success === true ? 'OK' : 'NO',
                code
            });

        });
    }
};
