'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');

const SOCKET_TIMEOUT = 60 * 1000;

class POP3Connection extends EventEmitter {
    constructor(server, socket) {
        super();
        this._server = server;
        this._socket = socket;

        this._closed = false;
        this._closing = false;

        this.remoteAddress = this._socket.remoteAddress;
        this._id = crypto.randomBytes(9).toString('base64');

        this.processing = false;
        this.queue = [];
        this._remainder = '';
    }

    init() {
        this._setListeners();
        this._resetSession();
        this._server.logger.info({
            tnx: 'connection',
            cid: this._id,
            host: this.remoteAddress
        }, 'Connection from %s', this.remoteAddress);
        this._socket.write('+OK WDPop ready for requests from ' + this.remoteAddress + '\r\n');
    }

    _setListeners() {
        this._socket.on('close', () => this._onClose());
        this._socket.on('error', err => this._onError(err));
        this._socket.setTimeout(this._server.options.socketTimeout || SOCKET_TIMEOUT, () => this._onTimeout());
        this._socket.on('readable', () => {
            if (this.processing) {
                return;
            }
            this.processing = true;

            this.read();
        });
    }

    /**
     * Fired when the socket is closed
     * @event
     */
    _onClose( /* hadError */ ) {
        if (this._closed) {
            return;
        }

        this.queue = [];
        this.processing = false;
        this._remainder = '';

        this._closed = true;
        this._closing = false;

        this._server.logger.info({
            tnx: 'close',
            cid: this._id,
            host: this.remoteAddress,
            user: this.user
        }, 'Connection closed to %s', this.remoteAddress);

        this.emit('close');
    }

    /**
     * Fired when an error occurs with the socket
     *
     * @event
     * @param {Error} err Error object
     */
    _onError(err) {
        if (err.code === 'ECONNRESET' || err.code === 'EPIPE') {
            return this.close(); // mark connection as 'closing'
        }

        this._server.logger.error({
            err,
            tnx: 'error',
            user: this.user
        }, '%s', err.message);
        this.emit('error', err);
    }

    /**
     * Fired when socket timeouts. Closes connection
     *
     * @event
     */
    _onTimeout() {
        this.close();
    }

    _resetSession() {
        this.session = {
            state: 'AUTHORIZATION'
        };
    }

    close() {
        if (!this._socket.destroyed && this._socket.writable) {
            this._socket.end();
        }
        this._closing = true;
    }

    read() {
        let chunk;
        let data = this._remainder;
        while ((chunk = this._socket.read()) !== null) {
            data += chunk.toString('binary');
            if (data.indexOf('\n') >= 0) {
                let lines = data.split(/\r?\n/).map(line => Buffer.from(line, 'binary').toString());
                this._remainder = lines.pop();

                if (lines.length) {
                    if (this.queue.length) {
                        this.queue = this.queue.concat(lines);
                    } else {
                        this.queue = lines;
                    }
                }

                return this.processQueue();
            }
        }

        this.processing = false;
    }

    processQueue() {
        if (!this.queue.length) {
            this.read(); // see if there's anything left to read
            return;
        }
        let line = this.queue.shift().trim();
        let parts = line.split(' ');
        let command = parts.shift().toUpperCase();
        let args = parts.join(' ');

        if (typeof this['command_' + command] === 'function') {
            this['command_' + command](args, err => {
                if (err) {
                    this._server.logger.info({
                        err,
                        tnx: 'command',
                        command,
                        cid: this._id,
                        host: this.remoteAddress
                    }, 'Error running %s. %s', command, err.message);
                    this._socket.write('-ERR ' + err.message + '\r\n');
                    this.close();
                } else {
                    this.processQueue();
                }
            });
        } else {
            this._socket.write('-ERR bad command\r\n');
            this.close();
        }
    }

    // https://tools.ietf.org/html/rfc2449#section-5
    command_CAPA(args, next) {
        let extensions = [
            'TOP',
            'UIDL',
            'USER',
            'RESP-CODES',
            // https://tools.ietf.org/html/rfc5034#section-6
            'SASL PLAIN'
        ];

        this._socket.write('+OK Capability list follows\r\n' +
            extensions.join('\r\n') + '\r\n.\r\n');

        next();
    }

    command_USER(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this._socket.write('-ERR Command not accepted\r\n');
            return next();
        }
        if (!args) {
            this._socket.write('-ERR USER who?\r\n');
            return next();
        }

        this.session.user = args;
        this._socket.write('+OK send PASS\r\n');
        return next();
    }

    command_PASS(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this._socket.write('-ERR Command not accepted\r\n');
            return next();
        }

        if (!this.session.user || !args) {
            return next(new Error('malformed command'));
        }

        let username = this.session.user;
        let password = args;
        this.session.user = false;

        this._server.onAuth({
            method: 'USER',
            username,
            password
        }, this.session, (err, response) => {

            if (err) {
                this._server.logger.info({
                    err,
                    tnx: 'autherror',
                    cid: this._id,
                    method: 'USER',
                    user: username
                }, 'Authentication error for %s using %s. %s', username, 'USER', err.message);
                return next(err);
            }

            if (!response.user) {
                this._server.logger.info({
                    tnx: 'authfail',
                    cid: this._id,
                    method: 'USER',
                    user: username
                }, 'Authentication failed for %s using %s', username, 'USER');
                this._socket.write('-ERR [AUTH] ' + (response.message || 'Username and password not accepted.') + '\r\n');
                return next();
            }

            this._server.logger.info({
                tnx: 'auth',
                cid: this._id,
                method: 'USER',
                user: username
            }, '%s authenticated using %s', username, 'USER');
            this.session.user = response.user;
            this.session.state = 'TRANSACTION';
            this._socket.write('+OK Welcome.\r\n');
            next();
        });
    }

    command_AUTH(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this._socket.write('-ERR Command not accepted\r\n');
            return next();
        }

        let params = args.split(/\s+/);
        let mechanism = params.shift().toUpperCase();
        let plain = params.shift();

        if (mechanism !== 'PLAIN') {
            this._socket.write('-ERR unsupported SASL mechanism\r\n');
            return next();
        }

        if (params.length || !/^[a-zA-Z0-9+\/]+=+?$/.test(plain)) {
            this._socket.write('-ERR malformed command\r\n');
            return next();
        }

        let credentials = Buffer.from(plain, 'base64').toString().split('\x00');
        if (credentials.length !== 3) {
            this._socket.write('-ERR malformed command\r\n');
            return next();
        }

        let username = credentials[1] || credentials[0] || '';
        let password = credentials[2] || '';

        this._server.onAuth({
            method: 'PLAIN',
            username,
            password
        }, this.session, (err, response) => {

            if (err) {
                this._server.logger.info({
                    err,
                    tnx: 'autherror',
                    cid: this._id,
                    method: 'PLAIN',
                    user: username
                }, 'Authentication error for %s using %s. %s', username, 'PLAIN', err.message);
                return next(err);
            }

            if (!response.user) {
                this._server.logger.info({
                    tnx: 'authfail',
                    cid: this._id,
                    method: 'PLAIN',
                    user: username
                }, 'Authentication failed for %s using %s', username, 'PLAIN');
                this._socket.write('-ERR [AUTH] ' + (response.message || 'Username and password not accepted.') + '\r\n');
                return next();
            }

            this._server.logger.info({
                tnx: 'auth',
                cid: this._id,
                method: 'PLAIN',
                user: username
            }, '%s authenticated using %s', username, 'PLAIN');
            this.session.user = response.user;
            this.session.state = 'TRANSACTION';
            this._socket.write('+OK Welcome.\r\n');
            next();
        });
    }

    // https://tools.ietf.org/html/rfc1939#page-9
    command_NOOP(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this._socket.write('-ERR Command not accepted\r\n');
        } else {
            this._socket.write('+OK\r\n');
        }
        return next();
    }

    // https://tools.ietf.org/html/rfc1939#section-6
    command_QUIT() {
        let finish = () => {
            this._socket.write('+OK Bye\r\n');
            this.close();
        };

        if (this.session.state !== 'TRANSACTION') {
            return finish();
        }
        this.session.state = 'UPDATE';
        // TODO: run pending actions
        finish();
    }
}

module.exports = POP3Connection;
