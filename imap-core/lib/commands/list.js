'use strict';

const imapHandler = require('../handler/imap-handler');
const imapTools = require('../imap-tools');
const utf7 = require('utf7').imap;

// tag LIST (SPECIAL-USE) "" "%" RETURN (SPECIAL-USE)

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [
        {
            name: 'selection',
            type: ['array'],
            optional: true
        },
        {
            name: 'reference',
            type: 'string'
        },
        {
            name: 'mailbox',
            type: 'string'
        },
        {
            name: 'return',
            type: 'atom',
            optional: true
        },
        {
            name: 'return',
            type: 'array',
            optional: true
        }
    ],

    handler(command, callback) {
        let filterSpecialUseFolders = false;
        let filterSpecialUseFlags = false;
        let reference;
        let mailbox;

        let arrPos = 0;

        // (SPECIAL-USE)
        if (Array.isArray(command.attributes[0])) {
            if (command.attributes[0].length) {
                if (
                    command.attributes[0].length === 1 &&
                    command.attributes[0][0].type === 'ATOM' &&
                    command.attributes[0][0].value.toUpperCase() === 'SPECIAL-USE'
                ) {
                    filterSpecialUseFolders = true;
                } else {
                    return callback(new Error('Invalid argument provided for LIST'));
                }
            }
            arrPos++;
        }

        // ""
        reference = Buffer.from((command.attributes[arrPos] && command.attributes[arrPos].value) || '', 'binary').toString();
        arrPos++;

        // "%"
        mailbox = Buffer.from((command.attributes[arrPos] && command.attributes[arrPos].value) || '', 'binary').toString();
        arrPos++;

        // RETURN (SPECIAL-USE)
        if (arrPos < command.attributes.length) {
            if (command.attributes[arrPos].type === 'ATOM' && command.attributes[arrPos].value.toUpperCase() === 'RETURN') {
                arrPos++;
                if (
                    Array.isArray(command.attributes[arrPos]) &&
                    command.attributes[arrPos].length === 1 &&
                    command.attributes[arrPos][0].type === 'ATOM' &&
                    command.attributes[arrPos][0].value.toUpperCase() === 'SPECIAL-USE'
                ) {
                    filterSpecialUseFlags = true;
                } else {
                    return callback(new Error('Invalid argument provided for LIST'));
                }
            } else {
                return callback(new Error('Invalid argument provided for LIST'));
            }
        }

        // Check if LIST method is set
        if (typeof this._server.onList !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'LIST not implemented'
            });
        }

        let query = imapTools.normalizeMailbox(reference + mailbox, !this.acceptUTF8Enabled);

        let listResponse = (err, list) => {
            if (err) {
                return callback(err);
            }

            imapTools.filterFolders(imapTools.generateFolderListing(list), query).forEach(folder => {
                if (!folder) {
                    return;
                }

                if (filterSpecialUseFolders && !folder.specialUse) {
                    return;
                }

                let response = {
                    tag: '*',
                    command: 'LIST',
                    attributes: []
                };

                let flags = [];

                if (!filterSpecialUseFlags) {
                    flags = flags.concat(folder.flags || []);
                }

                flags = flags.concat(folder.specialUse || []);

                response.attributes.push(
                    flags.map(flag => ({
                        type: 'atom',
                        value: flag
                    }))
                );

                response.attributes.push('/');
                let path = folder.path;
                if (!this.acceptUTF8Enabled) {
                    path = utf7.encode(path);
                } else {
                    path = Buffer.from(path);
                }
                response.attributes.push(path);

                this.send(imapHandler.compiler(response));
            });

            callback(null, {
                response: 'OK'
            });
        };

        if (!mailbox && !filterSpecialUseFlags) {
            // return delimiter only
            let response = {
                tag: '*',
                command: 'LIST',
                attributes: [
                    [
                        {
                            type: 'atom',
                            value: '\\Noselect'
                        }
                    ],
                    '/',
                    '/'
                ]
            };
            this.send(imapHandler.compiler(response));
            return callback(null, {
                response: 'OK'
            });
        }

        // Do folder listing
        // Concat reference and mailbox. No special reference handling whatsoever
        this._server.onList(query, this.session, listResponse);
    }
};
