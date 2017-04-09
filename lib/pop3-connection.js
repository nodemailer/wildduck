'use strict';

const crypto = require('crypto');
const EventEmitter = require('events');
const packageData = require('../package.json');

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
        this.send('+OK WDPop ready for requests from ' + this.remoteAddress);
    }

    send(payload) {
        if (!this._socket || !this._socket.writable) {
            return;
        }

        if (Array.isArray(payload)) {
            payload = payload.join('\r\n') + '\r\n.';
        }

        this._server.logger.debug({
            tnx: 'send',
            cid: this._id,
            host: this.remoteAddress
        }, 'S:', payload);
        this._socket.write(payload + '\r\n');
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
            user: this.session.user && this.session.user.username
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
            user: this.session.user && this.session.user.username
        }, '%s', err.message);
        this.emit('error', err);
    }

    /**
     * Fired when socket timeouts. Closes connection
     *
     * @event
     */
    _onTimeout() {
        this.send('-ERR Disconnected for inactivity');
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

        this._server.logger.debug({
            tnx: 'receive',
            cid: this._id,
            user: this.session.user && this.session.user.username
        }, 'C:', (line || '').toString());

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
                    this.send('-ERR ' + err.message);
                    this.close();
                } else {
                    this.processQueue();
                }
            });
        } else {
            this.send('-ERR bad command');
            this.close();
        }
    }

    // https://tools.ietf.org/html/rfc2449#section-5
    command_CAPA(args, next) {
        let extensions = [
            'CAPA',
            // 'TOP',
            'UIDL',
            'USER',
            'RESP-CODES',
            // https://tools.ietf.org/html/rfc5034#section-6
            'SASL PLAIN',
            // https://tools.ietf.org/html/rfc2449#section-6.6
            'PIPELINING',
            'IMPLEMENTATION WildDuck-v' + packageData.version
        ];

        this.send(['+OK Capability list follows'].concat(extensions));

        next();
    }

    command_USER(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this.send('-ERR Command not accepted');
            return next();
        }
        if (!args) {
            this.send('-ERR USER who?');
            return next();
        }

        this.session.user = args;
        this.send('+OK send PASS');
        return next();
    }

    command_PASS(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this.send('-ERR Command not accepted');
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
                this.send('-ERR [AUTH] ' + (response.message || 'Username and password not accepted'));
                return next();
            }

            this._server.logger.info({
                tnx: 'auth',
                cid: this._id,
                method: 'USER',
                user: username
            }, '%s authenticated using %s', username, 'USER');
            this.session.user = response.user;

            this.openMailbox(err => {
                if (err) {
                    return next(err);
                }
                next();
            });
        });
    }

    command_AUTH(args, next) {
        if (this.session.state !== 'AUTHORIZATION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let params = args.split(/\s+/);
        let mechanism = params.shift().toUpperCase();
        let plain = params.shift();

        if (mechanism !== 'PLAIN') {
            this.send('-ERR unsupported SASL mechanism');
            return next();
        }

        if (params.length || !/^[a-zA-Z0-9+\/]+=+?$/.test(plain)) {
            this.send('-ERR malformed command');
            return next();
        }

        let credentials = Buffer.from(plain, 'base64').toString().split('\x00');
        if (credentials.length !== 3) {
            this.send('-ERR malformed command');
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
                this.send('-ERR [AUTH] ' + (response.message || 'Username and password not accepted'));
                return next();
            }

            this._server.logger.info({
                tnx: 'auth',
                cid: this._id,
                method: 'PLAIN',
                user: username
            }, '%s authenticated using %s', username, 'PLAIN');
            this.session.user = response.user;

            this.openMailbox(err => {
                if (err) {
                    return next(err);
                }
                next();
            });
        });
    }

    // https://tools.ietf.org/html/rfc1939#page-9
    command_NOOP(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
        } else {
            this.send('+OK');
        }
        return next();
    }

    // https://tools.ietf.org/html/rfc1939#section-6
    command_QUIT() {
        let finish = () => {
            this.session = false;
            this.send('+OK Bye');
            this.close();
        };

        if (this.session.state !== 'TRANSACTION') {
            return finish();
        }
        this.session.state = 'UPDATE';

        let deleted = this.session.listing.messages.filter(message => message.popped);
        let seen = this.session.listing.messages.filter(message => !message.seen && message.fetched && !message.popped);

        if (!deleted.length && !seen.length) {
            return finish();
        }

        this._server.onUpdate({
            deleted,
            seen
        }, this.session, finish);
    }

    // https://tools.ietf.org/html/rfc1939#page-6
    command_STAT(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
        } else {
            this.send('+OK ' + this.session.listing.count + ' ' + this.session.listing.size);
        }

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-6
    command_LIST(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (args && (isNaN(index) || index <= 0)) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        if (index) {
            this.send('+OK ' + index + ' ' + this.session.listing.messages[index - 1].size);
        } else {

            this.send(
                ['+OK ' + this.session.listing.count + ' ' + this.session.listing.size]
                .concat(
                    this.session.listing.messages
                    .filter(message => !message.popped)
                    .map((message, i) => (i + 1) + ' ' + message.size)
                ));
        }

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-12
    command_UIDL(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (args && (isNaN(index) || index <= 0)) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        if (index) {
            this.send('+OK ' + index + ' ' + this.session.listing.messages[index - 1].id);
        } else {
            this.send(
                ['+OK']
                .concat(
                    this.session.listing.messages
                    .filter(message => !message.popped)
                    .map((message, i) => (i + 1) + ' ' + message.id)
                ));
        }

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-8
    command_DELE(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (!args || isNaN(index) || index <= 0) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        let message = this.session.listing.messages[index - 1];

        if (message.popped) {
            this.send('-ERR message ' + index + ' already deleted');
            return next();
        }

        message.popped = true;
        this.session.listing.count--;
        this.session.listing.size -= message.size;

        this.send('+OK message ' + index + ' deleted');
        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-9
    command_RSET(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let count = 0;
        let size = 0;
        this.session.listing.messages.forEach(message => {
            if (message.popped) {
                message.popped = false;
                count++;
                size += message.size;
            }
        });

        this.session.listing.count += count;
        this.session.listing.size += size;

        this.send('+OK maildrop has ' + this.session.listing.count + ' message' + (this.session.listing.count !== 1 ? 's' : '') + ' (' + this.session.listing.size + ' octets)');

        return next();
    }

    // https://tools.ietf.org/html/rfc1939#page-8
    command_RETR(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
            return next();
        }

        let index = false;
        if (args) {
            index = Number(args);
        }

        if (!args || isNaN(index) || index <= 0) {
            return next(new Error('malformed command'));
        }

        if (args && index > this.session.listing.messages.length) {
            this.send('-ERR no such message, only ' + this.session.listing.messages.length + ' messages in maildrop');
            return next();
        }

        let message = this.session.listing.messages[index - 1];

        if (message.popped) {
            this.send('-ERR message ' + index + ' already deleted');
            return next();
        }

        this._server.onFetchMessage(message.id, this.session, (err, stream) => {
            if (err) {
                return next(err);
            }

            if (!stream) {
                return next(new Error('Can not find message'));
            }

            stream.once('error', err => next(err));
            stream.once('end', () => {
                this.send('.');
                message.fetched = true;
                return next();
            });

            this.send('+OK ' + message.size + ' octets');
            stream.pipe(this._socket, {
                end: false
            });
        });
    }

    // https://tools.ietf.org/html/rfc1939#page-11
    command_TOP(args, next) {
        if (this.session.state !== 'TRANSACTION') {
            this.send('-ERR Command not accepted');
        }
        this.send('-ERR Future feature');
        return next();
    }

    openMailbox(next) {
        this._server.onListMessages(this.session, (err, listing) => {
            if (err) {
                this._server.logger.info({
                    err,
                    tnx: 'listerr',
                    cid: this._id,
                    user: this.session.user && this.session.user.username
                }, 'Failed listing messages for %s. %s', this.session.user.username, err.message);
                return next(err);
            }

            this.session.listing = listing;

            this.session.state = 'TRANSACTION';
            this.send('+OK maildrop has ' + listing.count + ' message' + (listing.count !== 1 ? 's' : '') + ' (' + listing.size + ' octets)');

            return next();
        });
    }
}

module.exports = POP3Connection;
