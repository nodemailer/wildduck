'use strict';

const config = require('wild-config');
const EventEmitter = require('events');
const net = require('net');
const tls = require('tls');
const packageData = require('../../package.json');
const tlsOptions = require('../../imap-core/lib/tls-options');
const shared = require('nodemailer/lib/shared');
const IRCConnection = require('./connection');
const tools = require('../tools');
const redis = require('redis');

const CLOSE_TIMEOUT = 1 * 1000; // how much to wait until pending connections are terminated

class IRCServer extends EventEmitter {
    constructor(options) {
        super();

        this.version = 'WildDuck-v' + packageData.version;

        this.startTime = new Date();
        let dateparts = this.startTime.toUTCString().split(/[\s,]+/);
        dateparts.splice(1, 0, dateparts[2]);
        dateparts.splice(3, 1);
        dateparts.splice(4, 0, 'at');
        this.startTimeFormatted = dateparts.join(' ');

        this.options = options || {};

        this.name = this.options.name || 'Localnet';

        this.motd = 'Wild Duck IRC'; // is changed later

        this.messageHandler = false; // is set later
        this.userHandler = false; // is set later

        this.disabledNicks = ['admin', 'root', 'nickserv'];

        this.supported = {
            CASEMAPPING: 'rfc7613',
            CHANTYPES: '#&',
            NETWORK: this.name,
            FNC: true
        };

        this.supportedFormatted = Object.keys(this.supported).map(key => key.toUpperCase() + (this.supported[key] === true ? '' : '=' + this.supported[key]));

        this._channels = new Map();
        this._clients = new Map();
        this._nicks = new Map();

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
            component: this.options.component || 'irc-server'
        });

        this.server = (this.options.secure ? tls : net).createServer(this.options, socket => this._onConnect(socket));

        this.publisher = redis.createClient(tools.redisConfig(config.dbs.redis));
        this.subsriber = redis.createClient(tools.redisConfig(config.dbs.redis));

        this.subscribers = new Map();
        this._listeners = new EventEmitter();
        this._listeners.setMaxListeners(0);

        this.subsriber.on('message', (channel, message) => {
            if (this.subscribers.has(channel)) {
                let data;
                try {
                    data = JSON.parse(message);
                } catch (E) {
                    return;
                }
                this._listeners.emit(channel, data);
            }
        });

        this._setListeners();
    }

    subscribe(session, channel, handler) {
        if (!this.subscribers.has(channel)) {
            this.subscribers.set(channel, new Map([[session, handler]]));
            this.subsriber.subscribe(channel);
        } else if (!this.subscribers.get(channel).has(session)) {
            this.subscribers.get(channel).set(session, handler);
        } else {
            return;
        }
        this._listeners.addListener(channel, handler);
    }

    unsubscribe(session, channel) {
        if (!this.subscribers.has(channel) || !this.subscribers.get(channel).has(session)) {
            return;
        }
        let handler = this.subscribers.get(channel).get(session);
        this._listeners.removeListener(channel, handler);
        this.subscribers.get(channel).delete(session);
        if (!this.subscribers.get(channel).size) {
            this.subscribers.delete(channel);
            this.subsriber.unsubscribe(channel);
        }
    }

    publish(session, channel, data) {
        this.publisher.publish(channel, JSON.stringify(data));
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
                protocol: 'IRC'
            },
            '%s%s Server listening on %s:%s',
            this.options.secure ? 'Secure ' : '',
            'IRC',
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
            'IRC Server closed'
        );
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
        let connection = new IRCConnection(this, socket);
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
                    connection.close();
                });
            }
        }, timeout);
    }

    listen(...args) {
        this.server.listen(...args);
    }

    join(name, client) {
        let nameLC = name.toLowerCase();
        if (!this._channels.has(nameLC)) {
            this._channels.set(nameLC, {
                name,
                topic: 'unset',
                clients: new Set()
            });
        }
        let channel = this._channels.get(nameLC);
        if (!channel.clients.has(client)) {
            channel.clients.add(client);
            let clientName = client.getFormattedName();
            let names = [];
            channel.clients.forEach(c => {
                c.send({ source: clientName, verb: 'JOIN', target: false, message: name });
                names.push(c.session.nick);
            });
            client.send({ verb: 'RPL_NAMREPLY', params: ['=', name], message: names.join(' ') });
            client.send({ verb: 'RPL_ENDOFNAMES', params: name, message: 'End of /NAMES list' });
            if (!this._clients.get(client)) {
                this._clients.set(client, { nick: client.session.nick, channels: new Set([channel]) });
            } else {
                this._clients.get(client).channels.add(channel);
            }
        }
    }

    quit(client, message) {
        if (!this._clients.has(client)) {
            return;
        }

        let clientName = client.getFormattedName();
        this._clients.get(client).channels.forEach(channel => {
            if (channel.clients.has(client)) {
                channel.clients.forEach(c => {
                    c.send({ source: clientName, verb: 'QUIT', target: false, message });
                });
                channel.clients.delete(client);
            }
        });

        this._clients.delete(client);
        this._nicks.delete(client.session.nick);
    }

    leave(name, client, message) {
        let nameLC = name.toLowerCase();
        if (!this._channels.has(nameLC)) {
            client.send({ verb: 'ERR_NOSUCHNICK', params: name, message: 'No such channel' });
            return;
        }
        let channel = this._channels.get(nameLC);
        if (channel.clients.has(client)) {
            let clientName = client.getFormattedName();
            channel.clients.forEach(c => {
                c.send({ source: clientName, verb: 'PART', target: false, params: channel.name, message });
            });
            channel.clients.delete(client);
            this._clients.get(client).channels.delete(channel);
        }
    }

    nick(client) {
        if (!this._clients.has(client)) {
            this._clients.set(client, { nick: client.session.nick, channels: new Set() });
            this._nicks.set(client.session.nick.toLowerCase(), client);
            return;
        }
        let entry = this._clients.get(client);
        if (entry.nick !== client.session.nick) {
            let updated = new WeakSet();
            let clientName = entry.nick + '!' + client.getFormattedName(true);
            entry.channels.forEach(channel => {
                channel.clients.forEach(c => {
                    if (updated.has(c)) {
                        return;
                    }
                    updated.add(c);
                    c.send({ source: clientName, verb: 'NICK', target: false, params: client.session.nick });
                });
            });
            this._nicks.delete(entry.nick.toLowerCase());
        }

        entry.nick = client.session.nick;
        this._nicks.set(client.session.nick.toLowerCase(), client);
    }
}

module.exports = IRCServer;
