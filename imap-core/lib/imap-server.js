'use strict';

let net = require('net');
let tls = require('tls');
let IMAPConnection = require('./imap-connection').IMAPConnection;
let tlsOptions = require('./tls-options');
let EventEmitter = require('events').EventEmitter;
let util = require('util');
let clone = require('clone');

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

        this.options = options ? clone(options) : {};

        // apply TLS defaults if needed
        if (this.options.secure) {
            this.options = tlsOptions(this.options);
        }

        // setup logger
        if ('logger' in this.options) {
            // use provided logger or use vanity logger if option is set to false
            this.logger = this.options.logger || {
                info: () => false,
                debug: () => false,
                error: () => false
            };
        } else {
            // create default console logger
            this.logger = this._createDefaultLogger();
        }

        /**
         * Timeout after close has been called until pending connections are forcibly closed
         */
        this._closeTimeout = false;

        /**
         * A set of all currently open connections
         */
        this.connections = new Set();

        // setup server listener and connection handler
        this.server = (this.options.secure ? tls : net).createServer(this.options, socket => {
            let connection = new IMAPConnection(this, socket);
            this.connections.add(connection);
            connection.on('error', this._onError.bind(this));
            connection.init();
        });

        this._setListeners();
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
            this.logger.info('Server closing with %s pending connection%s, waiting %s seconds before terminating', connections, connections !== 1 ? 's' : '', timeout / 1000);
        }

        this._closeTimeout = setTimeout(() => {
            connections = this.connections.size;
            if (connections) {
                this.logger.info('Closing %s pending connection%s to close the server', connections, connections !== 1 ? 's' : '');

                this.connections.forEach(connection => {
                    connection.send('* BYE System shutdown');
                    connection.close();
                });
            }
        }, timeout);
    }

    // PRIVATE METHODS

    /**
     * Generates a bunyan-like logger that prints to console
     *
     * @returns {Object} Bunyan logger instance
     */
    _createDefaultLogger() {

        let logger = {
            _print: (...args) => {
                let level = args.shift();
                let message;

                if (args.length > 1) {
                    message = util.format(...args);
                } else {
                    message = args[0];
                }

                console.log('[%s] %s: %s', // eslint-disable-line no-console
                    new Date().toISOString().substr(0, 19).replace(/T/, ' '),
                    level.toUpperCase(),
                    message);
            }
        };

        logger.info = logger._print.bind(null, 'info');
        logger.debug = logger._print.bind(null, 'debug');
        logger.error = logger._print.bind(null, 'error');

        return logger;
    }

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
            '%sIMAP Server listening on %s:%s',
            this.options.secure ? 'Secure ' : '',
            address.family === 'IPv4' ? address.address : '[' + address.address + ']',
            address.port);
    }

    /**
     * Called when server is closed
     *
     * @event
     */
    _onClose() {
        this.logger.info('IMAP Server closed');
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

}

// Expose to the world
module.exports.IMAPServer = IMAPServer;
