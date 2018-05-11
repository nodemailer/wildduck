'use strict';

const imapTools = require('../imap-tools');

module.exports = {
    state: ['Authenticated', 'Selected'],

    // we do not show * EXIST response for added message, so keep other notifications quet as well
    // otherwise we might end up in situation where APPEND emits an unrelated * EXISTS response
    // which does not yet take into account the appended message
    disableNotifications: true,

    schema: [
        {
            name: 'path',
            type: 'string'
        },
        {
            name: 'flags',
            type: 'array',
            optional: true
        },
        {
            name: 'datetime',
            type: 'string',
            optional: true
        },
        {
            name: 'message',
            type: 'literal'
        }
    ],

    handler(command, callback) {
        // Check if APPEND method is set
        if (typeof this._server.onAppend !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'APPEND not implemented'
            });
        }

        let path = Buffer.from((command.attributes.shift() || {}).value || 'binary').toString();
        path = imapTools.normalizeMailbox(path, !this.acceptUTF8Enabled);
        let message = command.attributes.pop();
        let flags = [];
        let internaldate = false;
        let parsedDate;

        if (command.attributes.length === 2) {
            flags = command.attributes[0] || [];
            internaldate = (command.attributes[1] && command.attributes[1].value) || '';
        } else if (command.attributes.length === 1) {
            if (Array.isArray(command.attributes[0])) {
                flags = command.attributes[0];
            } else {
                internaldate = (command.attributes[0] && command.attributes[0].value) || '';
            }
        }

        flags = flags.map(flag => (flag.value || '').toString());

        if (!path) {
            return callback(new Error('Invalid mailbox argument for APPEND'));
        }

        if (!/^literal$/i.test(message.type)) {
            return callback(new Error('Invalid message argument for APPEND'));
        }

        if (internaldate) {
            if (!validateInternalDate(internaldate)) {
                return callback(new Error('Invalid date argument for APPEND'));
            }

            parsedDate = new Date(internaldate);
            if (parsedDate.toString() === 'Invalid Date' || parsedDate.getTime() > Date.now() + 24 * 3600 * 1000 || parsedDate.getTime() <= 1000) {
                return callback(new Error('Invalid date-time argument for APPEND'));
            }
        }

        for (let i = flags.length - 1; i >= 0; i--) {
            if (flags[i].charAt(0) === '\\') {
                if (imapTools.systemFlags.indexOf(flags[i].toLowerCase()) < 0) {
                    return callback(new Error('Invalid system flag argument for APPEND'));
                } else {
                    // fix flag case
                    flags[i] = flags[i].toLowerCase().replace(/^\\./, c => c.toUpperCase());
                }
            }
        }

        // keep only unique flags
        flags = flags.filter((flag, i) => {
            if (i && flags.slice(0, i).indexOf(flag) >= 0) {
                return false;
            }
            return true;
        });

        this._server.onAppend(
            path,
            flags,
            internaldate,
            Buffer.from(typeof message.value === 'string' ? message.value : (message.value || '').toString(), 'binary'),
            this.session,
            (err, success, info) => {
                if (err) {
                    return callback(err);
                }

                let code = typeof success === 'string' ? success.toUpperCase() : 'APPENDUID ' + info.uidValidity + ' ' + info.uid;

                callback(null, {
                    response: success === true ? 'OK' : 'NO',
                    code
                });
            }
        );
    }
};

function validateInternalDate(internaldate) {
    if (!internaldate || typeof internaldate !== 'string') {
        return false;
    }
    return /^([ \d]\d)-(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)-(\d{4}) (\d{2}):(\d{2}):(\d{2}) ([-+])(\d{2})(\d{2})$/i.test(internaldate);
}
