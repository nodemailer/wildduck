'use strict';

// openssl s_client -starttls imap -crlf -connect localhost:1143

let tls = require('tls');
let tlsOptions = require('../tls-options');

let SOCKET_TIMEOUT = 30 * 60 * 1000;

module.exports = {
    handler(command, callback) {
        if (this.secure) {
            return callback(null, {
                response: 'NO',
                message: 'Connection is already secured'
            });
        }

        setImmediate(upgrade.bind(null, this));

        callback(null, {
            response: 'OK'
        });
    }
};

/**
 * Upgrades current socket to use TLS
 * @param {Object} connection IMAPConnection instance
 */
function upgrade(connection) {
    connection._socket.unpipe(connection._parser);
    connection.writeStream.unpipe(connection._socket);
    connection._upgrading = true;

    let secureContext = tls.createSecureContext(tlsOptions(connection._server.options));
    let socketOptions = {
        isServer: true,
        secureContext
    };

    // Apply additional socket options if these are set in the server options
    ['requestCert', 'rejectUnauthorized', 'session'].forEach(key => {
        if (key in connection._server.options) {
            socketOptions[key] = connection._server.options[key];
        }
    });

    // remove all listeners from the original socket besides the error handler
    connection._socket.removeAllListeners();
    connection._socket.on('error', connection._onError.bind(connection));

    // upgrade connection
    let secureSocket = new tls.TLSSocket(connection._socket, socketOptions);

    secureSocket.on('close', connection._onClose.bind(connection));
    secureSocket.on('error', connection._onError.bind(connection));
    secureSocket.on('clientError', connection._onError.bind(connection));
    secureSocket.setTimeout(connection._server.options.socketTimeout || SOCKET_TIMEOUT, connection._onTimeout.bind(connection));

    secureSocket.on('secure', () => {
        connection.secure = true;
        connection._socket = secureSocket;
        connection._upgrading = false;

        connection._server.logger.info({
            tnx: 'starttls',
            cid: connection.id
        }, '[%s] Connection upgraded to TLS', connection.id);
        connection._socket.pipe(connection._parser);
        connection.writeStream.pipe(connection._socket);
    });
}
