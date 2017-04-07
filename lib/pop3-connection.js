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
        this.session = {};
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

        console.log({
            command,
            args
        });

        setImmediate(() => this.processQueue());
    }
}

module.exports = POP3Connection;
