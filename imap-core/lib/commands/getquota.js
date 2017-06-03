'use strict';

let imapHandler = require('../handler/imap-handler');

// tag GETQUOTA ""

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [
        {
            name: 'quotaroot',
            type: 'string'
        }
    ],

    handler(command, callback) {
        let quotaRoot = Buffer.from((command.attributes[0] && command.attributes[0].value) || '', 'binary').toString();

        if (typeof this._server.onGetQuota !== 'function') {
            return callback(null, {
                response: 'NO',
                message: command.command + ' not implemented'
            });
        }

        this._server.onGetQuota(quotaRoot, this.session, (err, data) => {
            if (err) {
                return callback(err);
            }

            if (typeof data === 'string') {
                return callback(null, {
                    response: 'NO',
                    code: data.toUpperCase()
                });
            }

            // * QUOTA "" (STORAGE 220676 15728640)
            this.send(
                imapHandler.compiler({
                    tag: '*',
                    command: 'QUOTA',
                    attributes: [
                        data.root || '',
                        [
                            {
                                type: 'atom',
                                value: 'STORAGE'
                            },
                            {
                                type: 'atom',
                                value: String(Math.ceil((Number(data.storageUsed) || 0) / 1024))
                            },
                            {
                                type: 'atom',
                                value: String(Math.ceil((Number(data.quota) || 0) / 1024))
                            }
                        ]
                    ]
                })
            );

            callback(null, {
                response: 'OK',
                message: 'Success'
            });
        });
    }
};
