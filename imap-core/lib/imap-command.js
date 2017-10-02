'use strict';

const imapHandler = require('./handler/imap-handler');
const errors = require('../../lib/errors.js');
const MAX_MESSAGE_SIZE = 1 * 1024 * 1024;

const commands = new Map([
    /*eslint-disable global-require*/
    // require must normally be on top of the module
    ['NOOP', require('./commands/noop')],
    ['CAPABILITY', require('./commands/capability')],
    ['LOGOUT', require('./commands/logout')],
    ['ID', require('./commands/id')],
    ['STARTTLS', require('./commands/starttls')],
    ['LOGIN', require('./commands/login')],
    ['AUTHENTICATE PLAIN', require('./commands/authenticate-plain')],
    ['NAMESPACE', require('./commands/namespace')],
    ['LIST', require('./commands/list')],
    ['LSUB', require('./commands/lsub')],
    ['SUBSCRIBE', require('./commands/subscribe')],
    ['UNSUBSCRIBE', require('./commands/unsubscribe')],
    ['CREATE', require('./commands/create')],
    ['DELETE', require('./commands/delete')],
    ['RENAME', require('./commands/rename')],
    ['SELECT', require('./commands/select')],
    ['EXAMINE', require('./commands/select')],
    ['IDLE', require('./commands/idle')],
    ['CHECK', require('./commands/check')],
    ['STATUS', require('./commands/status')],
    ['APPEND', require('./commands/append')],
    ['STORE', require('./commands/store')],
    ['UID STORE', require('./commands/uid-store')],
    ['EXPUNGE', require('./commands/expunge')],
    ['UID EXPUNGE', require('./commands/uid-expunge')],
    ['CLOSE', require('./commands/close')],
    ['UNSELECT', require('./commands/unselect')],
    ['COPY', require('./commands/copy')],
    ['UID COPY', require('./commands/copy')],
    ['MOVE', require('./commands/move')],
    ['UID MOVE', require('./commands/move')],
    ['FETCH', require('./commands/fetch')],
    ['UID FETCH', require('./commands/fetch')],
    ['SEARCH', require('./commands/search')],
    ['UID SEARCH', require('./commands/search')],
    ['ENABLE', require('./commands/enable')],
    ['GETQUOTAROOT', require('./commands/getquotaroot')],
    ['SETQUOTA', require('./commands/setquota')],
    ['GETQUOTA', require('./commands/getquota')],
    ['COMPRESS', require('./commands/compress')]
    /*eslint-enable global-require*/
]);

class IMAPCommand {
    constructor(connection) {
        this.connection = connection;
        this.payload = '';
        this.first = true;
    }

    append(command, callback) {
        let chunks = [];
        let chunklen = 0;

        this.payload += command.value;

        if (this.first) {
            // fetch tag and command name
            this.first = false;

            // only check payload if it is a regular command, not input for something else
            if (typeof this.connection._nextHandler !== 'function') {
                let match = /^([^\s]+)(?:\s+((?:AUTHENTICATE |UID )?[^\s]+)|$)/i.exec(command.value) || [];
                this.tag = match[1];
                this.command = (match[2] || '').trim().toUpperCase();

                if (!this.command || !this.tag) {
                    let err = new Error('Invalid tag');
                    errors.notifyConnection(this.connection, err, {
                        payload: this.payload ? (this.payload.length < 256 ? this.payload : this.payload.toString().substr(0, 150) + '...') : false
                    });
                    this.connection.send('* BAD Invalid tag');
                    return callback(err);
                }

                if (!commands.has(this.command)) {
                    let err = new Error('Unknown command');
                    errors.notifyConnection(this.connection, err, {
                        payload: this.payload ? (this.payload.length < 256 ? this.payload : this.payload.toString().substr(0, 150) + '...') : false
                    });
                    this.connection.send(this.tag + ' BAD Unknown command: ' + this.command);
                    return callback(err);
                }
            }
        }

        if (command.literal) {
            // check if the literal size is in acceptable bounds
            if (isNaN(command.expecting) || isNaN(command.expecting) < 0 || command.expecting > Number.MAX_SAFE_INTEGER) {
                errors.notifyConnection(this.connection, new Error('Invalid literal size'), {
                    command: {
                        expecting: command.expecting
                    }
                });
                this.connection.send(this.tag + ' BAD Invalid literal size');
                this.payload = '';
                this.first = true;
                return callback(new Error('Literal too big'));
            }

            let maxAllowed = Math.max(Number(this.connection._server.options.maxMessage) || 0, MAX_MESSAGE_SIZE);
            if (
                // Allow large literals for selected commands only
                (!['APPEND'].includes(this.command) && command.expecting > 1024) ||
                // Deny all literals bigger than maxMessage
                command.expecting > maxAllowed
            ) {
                this.connection._server.logger.debug(
                    {
                        tnx: 'client',
                        cid: this.connection.id
                    },
                    '[%s] C:',
                    this.connection.id,
                    this.payload
                );

                this.payload = ''; // reset payload

                if (command.expecting > maxAllowed) {
                    // APPENDLIMIT response for too large messages
                    this.connection.send(this.tag + ' BAD [TOOBIG] Literal too large');
                } else {
                    this.connection.send(this.tag + ' NO Literal too large');
                }

                return callback(new Error('Literal too big'));
            }

            // Accept literal input
            this.connection.send('+ Go ahead');

            // currently the stream is buffered into a large string and thats it.
            // in the future we might consider some kind of actual stream usage
            command.literal.on('data', chunk => {
                chunks.push(chunk);
                chunklen += chunk.length;
            });

            command.literal.on('end', () => {
                this.payload += '\r\n' + Buffer.concat(chunks, chunklen).toString('binary');
                command.readyCallback(); // call this once stream is fully processed and ready to accept next data
            });
        }

        callback();
    }

    end(command, callback) {
        let callbackSent = false;
        let next = err => {
            if (!callbackSent) {
                callbackSent = true;
                return callback(err);
            }
        };

        this.append(command, err => {
            if (err) {
                return next(err);
            }

            // check if the payload needs to be directed to a preset handler
            if (typeof this.connection._nextHandler === 'function') {
                this.connection._server.logger.debug(
                    {
                        tnx: 'client',
                        cid: this.connection.id
                    },
                    '[%s] C: <%s bytes of data>',
                    this.connection.id,
                    (this.payload && this.payload.length) || 0
                );
                return this.connection._nextHandler(this.payload, next);
            }

            try {
                this.parsed = imapHandler.parser(this.payload);
            } catch (E) {
                errors.notifyConnection(this.connection, E, {
                    payload: this.payload ? (this.payload.length < 256 ? this.payload : this.payload.toString().substr(0, 150) + '...') : false
                });
                this.connection._server.logger.debug(
                    {
                        err: E,
                        tnx: 'client',
                        cid: this.connection.id
                    },
                    '[%s] C:',
                    this.connection.id,
                    this.payload
                );
                this.connection.send(this.tag + ' BAD ' + E.message);
                return next();
            }

            let handler = commands.get(this.command);

            if (/^(AUTHENTICATE|LOGIN)/.test(this.command) && Array.isArray(this.parsed.attributes)) {
                this.parsed.attributes.forEach(attr => {
                    if (attr && typeof attr === 'object' && attr.value) {
                        attr.sensitive = true;
                    }
                });
            }

            this.connection._server.logger.debug(
                {
                    tnx: 'client',
                    cid: this.connection.id
                },
                '[%s] C:',
                this.connection.id,
                imapHandler.compiler(this.parsed, false, true)
            );

            this.validateCommand(this.parsed, handler, err => {
                if (err) {
                    let payload = imapHandler.compiler(this.parsed, false, true);
                    errors.notifyConnection(this.connection, err, {
                        payload: payload ? (payload.length < 256 ? payload : payload.toString().substr(0, 150) + '...') : false
                    });
                    this.connection.send(this.tag + ' ' + (err.response || 'BAD') + ' ' + err.message);
                    return next(err);
                }

                if (typeof handler.handler === 'function') {
                    handler.handler.call(
                        this.connection,
                        this.parsed,
                        (err, response) => {
                            if (err) {
                                let payload = imapHandler.compiler(this.parsed, false, true);
                                errors.notifyConnection(this.connection, err, {
                                    payload: payload ? (payload.length < 256 ? payload : payload.toString().substr(0, 150) + '...') : false
                                });
                                this.connection.send(this.tag + ' ' + (err.response || 'BAD') + ' ' + err.message);
                                return next(err);
                            }

                            // send EXPUNGE, EXISTS etc queued notices
                            this.sendNotifications(handler, () => {
                                // send command ready response
                                this.connection.writeStream.write({
                                    tag: this.tag,
                                    command: response.response,
                                    attributes: []
                                        .concat(
                                            response.code
                                                ? {
                                                    type: 'SECTION',
                                                    section: [
                                                        {
                                                            type: 'TEXT',
                                                            value: response.code
                                                        }
                                                    ]
                                                }
                                                : []
                                        )
                                        .concat({
                                            type: 'TEXT',
                                            value: response.message || this.command + ' completed'
                                        })
                                });

                                next();
                            });
                        },
                        next
                    );
                } else {
                    this.connection.send(this.tag + ' NO Not implemented: ' + this.command);
                    return next();
                }
            });
        });
    }

    sendNotifications(handler, callback) {
        if (this.connection.state !== 'Selected' || !!handler.disableNotifications) {
            // nothing to advertise if not in Selected state
            return callback();
        }

        this.connection.emitNotifications();

        return callback();
    }

    validateCommand(parsed, handler, callback) {
        let schema = handler.schema || [];
        let maxArgs = schema.length;
        let minArgs = schema.filter(item => !item.optional).length;

        // Check if the command can be run in current state
        if (handler.state && [].concat(handler.state || []).indexOf(this.connection.state) < 0) {
            return callback(new Error(parsed.command.toUpperCase() + ' not allowed now'));
        }

        if (handler.schema === false) {
            //schema check is disabled
            return callback();
        }

        // Deny commands with too many arguments
        if (parsed.attributes && parsed.attributes.length > maxArgs) {
            return callback(new Error('Too many arguments provided'));
        }

        // Deny commands with too little arguments
        if (((parsed.attributes && parsed.attributes.length) || 0) < minArgs) {
            return callback(new Error('Not enough arguments provided'));
        }

        callback();
    }
}

module.exports.IMAPCommand = IMAPCommand;
