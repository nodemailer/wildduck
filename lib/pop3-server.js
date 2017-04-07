'use strict';

const EventEmitter = require('events');
const net = require('net');
const tls = require('tls');
const tlsOptions = require('../imap-core/lib/tls-options');
const shared = require('nodemailer/lib/shared');
const POP3Connection = require('./pop3-connection');

const CLOSE_TIMEOUT = 1 * 1000; // how much to wait until pending connections are terminated

class POP3Server extends EventEmitter {
    constructor(options) {
        super();

        this.options = options || {};

        // apply shorthand handlers
        ['onAuth'].forEach(handler => {
            if (typeof this.options[handler] === 'function') {
                this[handler] = this.options[handler];
            }
        });

        /**
         * Timeout after close has been called until pending connections are forcibly closed
         */
        this._closeTimeout = false;

        /**
         * A set of all currently open connections
         */
        this.connections = new Set();

        // apply TLS defaults if needed
        if (this.options.secure) {
            this.options = tlsOptions(this.options);
        }

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'pop3-server'
        });

        this.server = (this.options.secure ? tls : net)
            .createServer(this.options, socket => this._onConnect(socket));

        // ensure _sharedCreds, fixes an issue in node v4+ where STARTTLS fails because _sharedCreds does not exist
        this.server._sharedCreds = this.server._sharedCreds || this.secureContext.get('default');

        this._setListeners();
    }

    _setListeners() {
        this.server.on('listening', () => this._onListening());
        this.server.on('close', () => this._onClose());
        this.server.on('error', err => this._onError(err));
    }

    /**
     * Called when server started listening
     *
     * @event
     */
    _onListening() {
        let address = this.server.address();
        this.logger.info(
            //
            {
                tnx: 'listen',
                host: address.address,
                port: address.port,
                secure: !!this.options.secure,
                protocol: 'POP3'
            },
            '%s%s Server listening on %s:%s',
            this.options.secure ? 'Secure ' : '',
            'POP3',
            address.family === 'IPv4' ? address.address : '[' + address.address + ']',
            address.port);
    }

    /**
     * Called when server is closed
     *
     * @event
     */
    _onClose() {
        this.logger.info({
            tnx: 'closed'
        }, 'POP3 Server closed');
        this.emit('close');
    }

    /**
     * Called when an error occurs with the server
     *
     * @event
     */
    _onError(err) {
        this.emit('error', err);
    }

    _onConnect(socket) {
        let connection = new POP3Connection(this, socket);
        this.connections.add(connection);
        connection.once('error', err => {
            this.connections.delete(connection);
            this._onError(err);
        });
        connection.once('close', () => {
            this.connections.delete(connection);
        });
        connection.init();
    }

    close(callback) {
        let connections = this.connections.size;
        let timeout = this.options.closeTimeout || CLOSE_TIMEOUT;

        // stop accepting new connections
        this.server.close(() => {
            clearTimeout(this._closeTimeout);
            if (typeof callback === 'function') {
                return callback();
            }
        });

        // close active connections
        if (connections) {
            this.logger.info({
                tnx: 'close'
            }, 'Server closing with %s pending connection%s, waiting %s seconds before terminating', connections, connections !== 1 ? 's' : '', timeout / 1000);
        }

        this._closeTimeout = setTimeout(() => {
            connections = this.connections.size;
            if (connections) {
                this.logger.info({
                    tnx: 'close'
                }, 'Closing %s pending connection%s to close the server', connections, connections !== 1 ? 's' : '');

                this.connections.forEach(connection => {
                    connection.close();
                });
            }
        }, timeout);
    }

    /**
     * Authentication handler. Override this
     *
     * @param {Object} auth Authentication options
     * @param {Function} callback Callback to run once the user is authenticated
     */
    onAuth(auth, session, callback) {
        return callback(null, {
            message: 'Authentication not implemented'
        });
    }

    listen(...args) {
        this.server.listen(...args);
    }
}

module.exports = POP3Server;
