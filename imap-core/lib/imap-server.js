'use strict';

const net = require('net');
const tls = require('tls');
const IMAPConnection = require('./imap-connection').IMAPConnection;
const tlsOptions = require('./tls-options');
const EventEmitter = require('events').EventEmitter;
const shared = require('nodemailer/lib/shared');
const punycode = require('punycode');
const errors = require('../../lib/errors.js');

const CLOSE_TIMEOUT = 1 * 1000; // how much to wait until pending connections are terminated

/**
 * Creates a IMAP server instance.
 *
 * @constructor
 * @param {Object} options Connection and IMAP optionsž
 */
class IMAPServer extends EventEmitter {
    constructor(options) {
        super();

        this.options = options || {};

        this.updateSecureContext();

        this.logger = shared.getLogger(this.options, {
            component: this.options.component || 'imap-server'
        });

        /**
         * Timeout after close has been called until pending connections are forcibly closed
         */
        this._closeTimeout = false;

        /**
         * A set of all currently open connections
         */
        this.connections = new Set();

        // setup server listener and connection handler
        //this.server = (this.options.secure ? tls : net).createServer(this.options, 1);

        // setup server listener and connection handler
        if (this.options.secure && !this.options.needsUpgrade) {
            this.server = net.createServer(this.options, socket => {
                this._upgrade(socket, (err, tlsSocket) => {
                    if (err) {
                        return this._onError(err);
                    }
                    this.connect(tlsSocket);
                });
            });
        } else {
            this.server = net.createServer(this.options, socket => this.connect(socket));
        }

        this._setListeners();
    }

    connect(socket) {
        let connection = new IMAPConnection(this, socket);
        this.connections.add(connection);
        connection.on('error', this._onError.bind(this));
        connection.init();
    }

    /**
     * Start listening on selected port and interface
     */
    listen(...args) {
        this.server.listen(...args);
    }

    /**
     * Closes the server
     *
     * @param {Function} callback Callback to run once the server is fully closed
     */
    close(callback) {
        let connections = this.connections.size;
        let timeout = this.options.closeTimeout || CLOSE_TIMEOUT;

        // stop accepting new connections
        this.server.close(() => {
            clearTimeout(this._closeTimeout);
            callback();
        });

        // close active connections
        if (connections) {
            this.logger.info(
                {
                    tnx: 'close'
                },
                'Server closing with %s pending connection%s, waiting %s seconds before terminating',
                connections,
                connections !== 1 ? 's' : '',
                timeout / 1000
            );
        }

        this._closeTimeout = setTimeout(() => {
            connections = this.connections.size;
            if (connections) {
                this.logger.info(
                    {
                        tnx: 'close'
                    },
                    'Closing %s pending connection%s to close the server',
                    connections,
                    connections !== 1 ? 's' : ''
                );

                this.connections.forEach(connection => {
                    connection.send('* BYE System shutdown');
                    connection.close();
                });
            }
        }, timeout);
    }

    // PRIVATE METHODS

    /**
     * Setup server event handlers
     */
    _setListeners() {
        this.server.on('listening', this._onListening.bind(this));
        this.server.on('close', this._onClose.bind(this));
        this.server.on('error', this._onError.bind(this));
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
                protocol: 'IMAP'
            },
            '%sIMAP Server listening on %s:%s',
            this.options.secure ? 'Secure ' : '',
            address.family === 'IPv4' ? address.address : '[' + address.address + ']',
            address.port
        );
    }

    /**
     * Called when server is closed
     *
     * @event
     */
    _onClose() {
        this.logger.info(
            {
                tnx: 'closed'
            },
            'IMAP Server closed'
        );
        this.emit('close');
    }

    /**
     * Called when an error occurs with the server
     *
     * @event
     */
    _onError(err) {
        errors.notifyConnection(false, err);
        this.emit('error', err);
    }

    _upgrade(socket, callback) {
        let socketOptions = {
            secureContext: this.secureContext.get('*'),
            isServer: true,
            server: this.server,
            SNICallback: this.options.SNICallback
        };

        let remoteAddress = socket.remoteAddress;

        let errorTimer = false;
        let returned = false;
        let onError = err => {
            clearTimeout(errorTimer);
            if (returned) {
                return;
            }
            returned = true;
            if (err && /SSL23_GET_CLIENT_HELLO/.test(err.message)) {
                let message = err.message;
                err.message = 'Failed to establish TLS session';
                err.meta = {
                    protocol: 'imap',
                    stage: 'connect',
                    message,
                    remoteAddress
                };
            }
            if (!err || !err.message) {
                err = new Error('Socket closed while initiating TLS');
                err.report = false;
                err.meta = {
                    protocol: 'imap',
                    stage: 'connect',
                    remoteAddress
                };
            }
            callback(err);
        };

        // remove all listeners from the original socket besides the error handler
        socket.once('error', onError);

        // upgrade connection
        let tlsSocket = new tls.TLSSocket(socket, socketOptions);

        let onCloseError = hadError => {
            if (hadError) {
                return onError();
            }
        };
        tlsSocket.once('close', onCloseError);
        tlsSocket.once('error', onError);
        tlsSocket.once('_tlsError', onError);
        tlsSocket.once('clientError', onError);
        tlsSocket.once('tlsClientError', onError);

        tlsSocket.on('secure', () => {
            socket.removeListener('error', onError);
            tlsSocket.removeListener('close', onCloseError);
            tlsSocket.removeListener('error', onError);
            tlsSocket.removeListener('_tlsError', onError);
            tlsSocket.removeListener('clientError', onError);
            tlsSocket.removeListener('tlsClientError', onError);
            if (returned) {
                try {
                    tlsSocket.end();
                } catch (E) {
                    //
                }
                return;
            }
            returned = true;
            return callback(null, tlsSocket);
        });
    }

    updateSecureContext(options) {
        Object.keys(options || {}).forEach(key => {
            this.options[key] = options[key];
        });

        let defaultTlsOptions = tlsOptions(this.options);

        this.secureContext = new Map();
        this.secureContext.set('*', tls.createSecureContext(defaultTlsOptions));

        let ctxMap = this.options.sniOptions || {};
        // sniOptions is either an object or a Map with domain names as keys and TLS option objects as values
        if (typeof ctxMap.get === 'function') {
            ctxMap.forEach((ctx, servername) => {
                this.secureContext.set(this._normalizeHostname(servername), tls.createSecureContext(tlsOptions(ctx)));
            });
        } else {
            Object.keys(ctxMap).forEach(servername => {
                this.secureContext.set(this._normalizeHostname(servername), tls.createSecureContext(tlsOptions(ctxMap[servername])));
            });
        }

        if (this.options.secure) {
            // appy changes

            Object.keys(defaultTlsOptions || {}).forEach(key => {
                if (!(key in this.options)) {
                    this.options[key] = defaultTlsOptions[key];
                }
            });

            // ensure SNICallback method
            if (typeof this.options.SNICallback !== 'function') {
                // create default SNI handler
                this.options.SNICallback = (servername, cb) => {
                    cb(null, this.secureContext.get(this._normalizeHostname(servername)) || this.secureContext.get('*'));
                };
            }
        }
    }

    _normalizeHostname(hostname) {
        return punycode.toUnicode((hostname || '').toString().trim()).toLowerCase();
    }
}

// Expose to the world
module.exports.IMAPServer = IMAPServer;
