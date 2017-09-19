'use strict';

const dns = require('dns');
const crypto = require('crypto');
const EventEmitter = require('events');
const os = require('os');
const codes = require('./codes');
const db = require('../db');

const PING_TIMEOUT = 120 * 1000;
const SOCKET_TIMEOUT = 5 * 60 * 1000;

class IRCConnection extends EventEmitter {
    constructor(server, socket) {
        super();
        this.server = server;
        this._socket = socket;

        this._closed = false;
        this._closing = false;

        this._authenticating = false;

        this.remoteAddress = this._socket.remoteAddress;
        this.id = crypto
            .randomBytes(8)
            .toString('base64')
            .replace(/[=/+]+/g, '')
            .toUpperCase();

        this.connectionPass = false;

        this.hostname = (server.options.hostname || os.hostname() || this._socket.localAddress || 'localhost').toLowerCase().trim();

        this.processing = false;
        this.queue = [];
        this._remainder = '';

        this.starting = false;
        this.started = false;
        this.capStarted = false;
        this.capEnded = false;
        this.capEnabled = new Set();
    }

    init() {
        this._setListeners();
        this._resetSession();
        this.server.logger.info(
            {
                tnx: 'connection',
                cid: this.id,
                host: this.remoteAddress
            },
            'Connection from %s',
            this.remoteAddress
        );
        this.send({
            verb: 'NOTICE',
            target: false,
            params: 'Auth',
            message: '*** Looking up your hostname...'
        });
        try {
            dns.reverse(this.remoteAddress, (err, hostnames) => {
                if (!err && hostnames && hostnames.length) {
                    this.session.clientHostname = hostnames[0];
                    this.send({
                        verb: 'NOTICE',
                        target: false,
                        params: 'Auth',
                        message: '*** Found your hostname'
                    });
                } else {
                    this.session.clientHostname = this.remoteAddress;
                    this.send({
                        verb: 'NOTICE',
                        target: false,
                        params: 'Auth',
                        message: '*** Could not resolve your hostname; using your IP address (' + this.remoteAddress + ') instead'
                    });
                }
            });
        } catch (E) {
            this.session.clientHostname = this.remoteAddress;
            this.send({
                verb: 'NOTICE',
                target: false,
                params: '*',
                message: '*** Could not resolve your hostname; using your IP address (' + this.remoteAddress + ') instead'
            });
        }
        this.updatePinger();
    }

    write(payload) {
        if (!this._socket || !this._socket.writable) {
            return;
        }
        this._socket.write(payload);
    }

    send(payload) {
        if (!this._socket || !this._socket.writable) {
            return;
        }

        if (payload && typeof payload === 'object') {
            payload.source = payload.source || this.hostname;

            let message = [':' + payload.source];

            if (payload.verb) {
                let cmd = (payload.verb || '')
                    .toString()
                    .toUpperCase()
                    .trim();
                if (codes.has(cmd)) {
                    cmd = codes.get(cmd);
                }
                message.push(cmd);
            }

            if (payload.target) {
                message.push(payload.target);
            } else if (payload.target !== false) {
                message.push(this.session.nick || this.id);
            }

            if (payload.params) {
                message = message.concat(payload.params || []);
            }

            if (payload.message) {
                message.push(':' + payload.message);
            }

            payload = message.join(' ');
        }

        this.server.logger.debug(
            {
                tnx: 'send',
                cid: this.id,
                host: this.remoteAddress
            },
            'S:',
            (payload.length < 128 ? payload : payload.substr(0, 128) + '... +' + (payload.length - 128) + ' B').replace(/\r?\n/g, '\\n')
        );

        this.write(payload + '\r\n');
    }

    _setListeners() {
        this._socket.on('close', () => this._onClose());
        this._socket.on('error', err => this._onError(err));
        this._socket.setTimeout(this.server.options.socketTimeout || SOCKET_TIMEOUT, () => this._onTimeout());
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
    _onClose(/* hadError */) {
        if (this._closed) {
            return;
        }

        this.queue = [];
        this.processing = false;
        this._remainder = '';

        this._closed = true;
        this._closing = false;

        this.server.logger.info(
            {
                tnx: 'close',
                cid: this.id,
                host: this.remoteAddress,
                user: this.session.user
            },
            'Connection closed to %s',
            this.remoteAddress
        );

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

        this.server.logger.error(
            {
                err,
                tnx: 'error',
                user: this.session.user
            },
            '%s',
            err.message
        );
        this.emit('error', err);
    }

    /**
     * Fired when socket timeouts. Closes connection
     *
     * @event
     */
    _onTimeout() {
        // TODO: send timeout notification
        this.close();
    }

    _resetSession() {
        this.session = {
            state: 'AUTHORIZATION',
            remoteAddress: this.remoteAddress
        };
    }

    close() {
        clearTimeout(this.session.pingTimer);
        if (!this._socket.destroyed && this._socket.writable) {
            this._socket.end();
        }
        this._closing = true;
    }

    read() {
        // update PING timeout
        this.updatePinger();

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
        if (!line) {
            return this.processQueue();
        }

        let match = line.match(/^\s*(?::[^\s]+\s+)?([^\s]+)\s*/);
        if (!match) {
            // TODO: send error message
            // Can it even happen?
            return this.processQueue();
        }

        let verb = (match[1] || '').toString().toUpperCase();
        let params = line.substr(match[0].length);
        let data;
        let separatorPos = params.indexOf(' :');
        if (separatorPos >= 0) {
            data = params.substr(separatorPos + 2);
            params = params.substr(0, separatorPos);
        }
        params = params
            .trim()
            .split(/\s+/)
            .filter(arg => arg);
        if (data) {
            params.push(data);
        }

        let logLine = (line || '').toString();

        this.server.logger.debug(
            {
                tnx: 'receive',
                cid: this.id,
                user: this.session.user
            },
            'C:',
            logLine
        );

        if (typeof this['command_' + verb] === 'function') {
            this['command_' + verb](params, () => {
                this.processQueue();
            });
        } else {
            if (this.session.user) {
                this.send({
                    verb: 'ERR_UNKNOWNCOMMAND',
                    target: this.session.nick,
                    params: verb,
                    message: 'Unknown command'
                });
            }
            return this.processQueue();
        }
    }

    getFormattedName(skipNick) {
        return (!skipNick && this.session.nick ? this.session.nick + '!' : '') + (this.session.user || 'unknown') + '@' + this.session.clientHostname;
    }

    checkSessionStart() {
        if (this.starting || this.started) {
            return;
        }
        if (!this.session.user || !this.session.nick || (this.capStarted && !this.capEnded)) {
            return;
        }
        this.starting = true;

        this.server.logger.info(
            {
                tnx: 'session',
                cid: this.id,
                host: this.remoteAddress,
                user: this.session.user,
                name: this.session.name
            },
            'Registered %s as %s',
            this.session.user,
            JSON.stringify(this.session.name)
        );

        this.send({ verb: 'NOTICE', target: 'Auth', message: 'Welcome to \x02' + this.server.name + '\x02!' });

        this.send({ verb: 'RPL_WELCOME', message: 'Welcome to the ' + this.server.name + ' IRC Network ' + this.getFormattedName() });

        this.send({ verb: 'RPL_YOURHOST', message: 'Your host is ' + this.hostname + ', running version ' + this.server.version });

        this.send({ verb: 'RPL_CREATED', message: 'This server was created ' + this.server.startTimeFormatted });

        // TODO: use real flags, <available user modes> <available channel modes> [<channel modes with a parameter>
        this.send({ verb: 'RPL_MYINFO', params: [this.hostname, this.server.version, 'iosw', 'biklmnopstv', 'bklov'] });

        this.send({ verb: 'RPL_ISUPPORT', params: this.server.supportedFormatted, message: 'are supported by this server' });

        this.send({ verb: 'RPL_YOURID', params: this.id, message: 'your unique ID' });

        this.send({ verb: 'RPL_MOTDSTART', message: this.hostname + ' message of the day' });

        this.server.motd.split(/\r?\n/).forEach(line => this.send({ verb: 'RPL_MOTD', message: '- ' + line }));

        this.send({ verb: 'RPL_ENDOFMOTD', message: 'End of message of the day' });

        if (!this.session.auth) {
            this.send({
                source: 'NickServ!NickServ@services.',
                verb: 'NOTICE',
                message: 'This server requires all users to be authenticated. Identify via /msg NickServ identify <password>'
            });
        }

        this.starting = false;
        this.started = true;
    }

    authenticate(user, password, next) {
        this.server.userHandler.authenticate(
            user.replace(/\+/, '@'),
            password,
            'irc',
            {
                protocol: 'IRC',
                ip: this.remoteAddress
            },
            (err, result) => {
                if (err) {
                    return next(err);
                }
                if (!result) {
                    return next();
                }

                if (result.scope === 'master' && result.require2fa) {
                    // master password not allowed if 2fa is enabled!
                    return next();
                }

                //this.session.clientHostname = 'example.com';
                this.session.user = result.username;

                db.users.collection('users').findOne({ _id: result.user }, {
                    fields: {
                        _id: true,
                        username: true,
                        address: true,
                        name: true,
                        ns: true
                    }
                }, (err, userData) => {
                    if (err) {
                        return next(err);
                    }

                    let ns = userData.ns;

                    if (userData.address) {
                        let parts = userData.address.split('@');
                        this.session.user = parts.shift();
                        this.session.clientHostname = parts.join('@');
                        if (!ns) {
                            ns = this.session.clientHostname;
                        }
                    }

                    this.session.nick = this.session.nick || userData.username;
                    this.session.ns = ns || 'root';

                    next(null, {
                        id: userData._id,
                        username: userData.username
                    });
                });
            }
        );
    }

    getNick(nick, next) {
        let ns = this.session.ns;
        let nickview = nick.toLowerCase().replace(/\./g, '');
        let user = this.session.auth.id;

        let verifyUser = done => {
            if (nickview === this.session.auth.username.replace(/\./g, '')) {
                return done();
            }
            db.users.collection('users').findOne({
                ns,
                unameview: nickview
            }, {
                fields: {
                    _id: true,
                    username: true
                }
            }, (err, userData) => {
                if (err) {
                    return next(err);
                }
                if (userData && userData._id.toString() !== this.session.auth.id.toString()) {
                    let err = new Error('Can not acquire reserved nick');
                    err.verb = 'ERR_NICKNAMEINUSE ';

                    // make sure that the errouneus nick gets cleared
                    db.database.collection('nicks').deleteOne({
                        ns,
                        nickview: { $ne: nickview },
                        user
                    }, () => next(err));
                }
                return done();
            });
        };

        verifyUser(() => {
            db.database.collection('nicks').insertOne({
                ns,
                nickview,
                nick,
                user
            }, (err, r) => {
                if (err) {
                    if (err.code === 11000) {
                        return db.database.collection('nicks').findOne({
                            ns,
                            nickview
                        }, (err, nickData) => {
                            if (err) {
                                return next(err);
                            }

                            if (!nickData) {
                                err = new Error('Race condition in acquireing nick');
                                err.verb = 'ERR_NICKNAMEINUSE ';
                                return next(err);
                            }

                            if (nickData.user.toString() === user.toString()) {
                                return next(null, false);
                            }

                            err = new Error('Requested nick is already in use');
                            err.verb = 'ERR_NICKNAMEINUSE ';
                            return next(err);
                        });
                    }
                    return next(err);
                }
                let insertId = r && r.insertedId;
                if (!insertId) {
                    return next(new Error('Failed to set up nick'));
                }

                // try to remove old nicks
                db.database.collection('nicks').deleteOne({
                    ns,
                    nickview: { $ne: nickview },
                    user
                }, () => next(null, true));
            });
        });
    }

    verifyNickChange(currentSource, next) {
        this.getNick(this.session.nick, (err, changed) => {
            if (err) {
                currentSource = currentSource || this.getFormattedName();
                this.send({ verb: err.verb || 'ERR_UNAVAILRESOURCE', params: this.session.nick, message: err.message });
                this.session.nick = this.session.user;
            }

            if (currentSource) {
                this.send({ source: currentSource, verb: 'NICK', target: false, params: this.session.nick });
            }

            if (changed) {
                /*
                this.notifyAll({ source: currentSource, verb: 'NICK', target: false, params: this.session.nick }, ()=>{

                });
                */
            }

            this.server.nick(this);
            return next();
        });
    }

    checkAuth() {
        if (!this.session.auth) {
            this.send({ verb: 'ERR_NOTREGISTERED', params: 'PRIVMSG', message: 'Authentication required to chat in this server' });
            return false;
        }
        return true;
    }

    updatePinger() {
        clearTimeout(this.session.pingTimer);
        this.session.pingTimer = setTimeout(() => {
            this.send('PING :' + this.hostname);
            this.session.pingTimer = setTimeout(() => {
                this.send(
                    'ERROR :Closing link: (' +
                        (this.session.user || 'unknown') +
                        '@' +
                        this.session.clientHostname +
                        ') [Ping timeout: ' +
                        Math.round(PING_TIMEOUT / 1000) +
                        ' seconds]'
                );
                this.server.quit(this, 'Ping timeout: ' + Math.round(PING_TIMEOUT / 1000) + ' seconds');
                this.close();
            }, PING_TIMEOUT);
        }, PING_TIMEOUT);
    }

    command_QUIT() {
        this.send('ERROR :Closing link: (' + this.getFormattedName(true) + ') [Client exited]');
        this.server.quit(this, 'Client exited');
        this.close();
    }

    command_PING(params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'PING', message: 'Not enough parameters' });
            return next();
        }
        if (!this.session.user) {
            this.send({ verb: 'ERR_NOTREGISTERED', params: 'PING', message: 'You have not registered' });
            return next();
        }
        let host = params[0] || this.session.clientHostname;
        this.send({ verb: 'PONG', target: this.hostname, message: host });
        return next();
    }

    command_PONG(params, next) {
        return next();
    }

    command_NICK(params, next) {
        let currentSource = this.getFormattedName();

        if (params.length > 1) {
            this.send({ verb: 'ERR_ERRONEUSNICKNAME', params, message: 'Erroneous Nickname' });
            return next();
        } else if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params, message: 'Not enough parameters' });
            return next();
        } else if (this.server.disabledNicks.includes(params[0].trim().toLowerCase())) {
            this.send({ verb: 'ERR_ERRONEUSNICKNAME', params, message: 'Erroneous Nickname' });
            return next();
        } else {
            this.session.nick = params[0];
        }

        this.checkSessionStart();

        if (this.session.auth) {
            this.verifyNickChange(currentSource, next);
        } else {
            next();
        }
    }

    command_PASS(params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'PASS', message: 'Not enough parameters' });
            return next();
        }

        let pass = params.join(' ');

        this.connectionPass = pass;

        return next();
    }

    command_USER(params, next) {
        if (this.session.user) {
            this.send({ verb: 'ERR_ALREADYREGISTERED', message: 'You may not reregister' });
            return next();
        }

        if (params.length < 4) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'USER', message: 'Not enough parameters' });
            return next();
        }

        this.session.user = params[0];
        this.session.name = params.slice(3).join(' ');
        this.session.time = new Date();

        if (this.connectionPass) {
            this.authenticate(this.session.user, this.connectionPass, (err, auth) => {
                if (err) {
                    this.server.quit(this, 'User registration failed. ' + err.message);
                    return this.close();
                }
                if (auth) {
                    this.session.auth = auth;
                    this.checkSessionStart();
                    return this.verifyNickChange(false, next);
                }
                return next();
            });
        } else {
            this.checkSessionStart();
            return next();
        }
    }

    command_JOIN(params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', params: 'JOIN', message: 'You have not registered' });
            return next();
        }
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'JOIN', message: 'Not enough parameters' });
            return next();
        }

        let channel = params[0].trim();
        if (channel.length < 2 || !/^[#&]/.test(channel) || /[#&\s]/.test(channel.substr(1)) || /^[#&]\.+$/.test(channel)) {
            this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'Invalid channel name' });
            return next();
        }

        if (!this.checkAuth()) {
            return next();
        }

        let channelview = channel.toLowerCase().replace(/\./g, '');

        let tryCount = 0;
        let tryGetChannel = () => {
            db.database.collection('channels').findOne({
                channelview,
                ns: this.session.ns
            }, (err, channelData) => {
                if (err) {
                    this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                    return next();
                }

                if (channelData) {
                    this.server.join(channel, this);
                    return next();
                }

                db.database.collection('channels').insertOne({
                    channel,
                    channelview,
                    ns: this.session.ns,
                    user: this.session.auth.id,
                    mode: []
                }, err => {
                    if (err) {
                        if (err.code === 11000 && tryCount++ < 5) {
                            return setTimeout(tryGetChannel, 100);
                        }
                        this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                        return next();
                    }

                    this.server.join(channel, this);
                    return next();
                });
            });
        };
        tryGetChannel();
    }

    command_PART(params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', params: 'JOIN', message: 'You have not registered' });
            return next();
        }
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'JOIN', message: 'Not enough parameters' });
            return next();
        }

        let channel = params[0].trim();
        if (channel.length < 2 || !/^[#&]/.test(channel) || /[#&\s]/.test(channel.substr(1))) {
            this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'No such channel' });
            return next();
        }

        if (!this.checkAuth()) {
            return next();
        }

        this.server.leave(channel, this, params.slice(1).join(' '));

        return next();
    }

    command_PRIVMSG(params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', params: 'PRIVMSG', message: 'You have not registered' });
            return next();
        }

        if (params.length < 2) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'PRIVMSG', message: 'Not enough parameters' });
            return next();
        }

        let target = params[0].trim();
        if (/[#&\s]/.test(target.substr(1))) {
            this.send({ verb: 'ERR_NOSUCHNICK', params: target, message: 'No such nick/channel' });
            return next();
        }

        if (target.trim().toLowerCase() === 'nickserv') {
            return this.command_NICKSERV(
                params
                    .slice(1)
                    .join(' ')
                    .split(/\s+/)
                    .filter(arg => arg),
                next
            );
        }

        if (!this.checkAuth()) {
            return next();
        }

        this.server.send(target, this, params.slice(1).join(' '));

        return next();
    }

    command_CAP(params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', target: this.session.nick || '*', params: 'CAP', message: 'Not enough parameters' });
            return next();
        }

        let allowed = ['sasl'];

        this.capStarted = true;
        let subcommand = params
            .shift()
            .toUpperCase()
            .trim();

        switch (subcommand) {
            case 'LS':
                this.send({ verb: 'CAP', target: this.session.nick || '*', params: 'LS', message: allowed.join(' ') });
                break;

            case 'LIST':
                this.send({ verb: 'CAP', target: this.session.nick || '*', params: 'LIST', message: Array.from(this.capEnabled).join(' ') });
                break;

            case 'REQ':
                {
                    let ok = true;
                    let enable = [];
                    let disable = [];
                    params.forEach(arg => {
                        let argName = arg.trim().toLowerCase();
                        switch (argName.charAt(0)) {
                            case '-':
                                disable = true;
                                argName = argName.substr(1);
                                disable.push(argName);
                                break;
                            case '+':
                                argName = argName.substr(1);
                                enable.push(argName);
                                break;
                            default:
                                enable.push(argName);
                        }
                        if (!allowed.includes(argName)) {
                            // unknown extension
                            ok = false;
                        }
                    });

                    if (ok) {
                        // apply changes
                        enable.forEach(arg => this.capEnabled.add(arg));
                        disable.forEach(arg => this.capEnabled.delete(arg));
                    }

                    this.send({ verb: 'CAP', target: this.session.nick || '*', params: ok ? 'ACK' : 'NAK', message: params.join(' ') });
                }
                break;

            case 'END':
                this.capEnded = true;
                if (this._authenticating) {
                    this._authenticating = false;
                    this.send({ verb: 'ERR_SASLABORTED', target: this.session.nick || '*', message: 'SASL authentication aborted' });
                }

                this.checkSessionStart();
                break;
        }
        next();
    }

    command_NICKSERV(params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', target: this.session.nick || '*', params: 'CAP', message: 'Not enough parameters' });
            return next();
        }

        if (this.session.auth) {
            this.send({
                source: 'NickServ!NickServ@services.',
                verb: 'NOTICE',
                target: this.session.nick,
                message: 'Already identified as ' + this.session.user
            });
            return next();
        }

        this.capStarted = true;
        let subcommand = params
            .shift()
            .toUpperCase()
            .trim();

        switch (subcommand) {
            case 'IDENTIFY': {
                return this.authenticate(this.session.user, params.join(' '), (err, auth) => {
                    if (err) {
                        this.server.quit(this, 'User registration failed. ' + err.message);
                        return this.close();
                    }
                    if (auth) {
                        this.session.auth = auth;
                        this.send({
                            source: 'NickServ!NickServ@services.',
                            verb: 'NOTICE',
                            target: this.session.nick,
                            message: 'You are now identified for ' + this.session.user
                        });
                        return this.verifyNickChange(false, next);
                    } else {
                        this.send({
                            source: 'NickServ!NickServ@services.',
                            verb: 'NOTICE',
                            target: this.session.nick,
                            message: 'Invalid password for ' + this.session.user
                        });
                    }
                    return next();
                });
            }
        }
        next();
    }

    command_AUTHENTICATE(params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', target: this.session.nick || '*', params: 'AUTHENTICATE', message: 'Not enough parameters' });
            return next();
        }

        if (!this.capEnabled.has('sasl')) {
            // Authentication not enabled
            return next();
        }

        if (this.session.auth) {
            this.send({ verb: 'ERR_SASLALREADY', target: this.session.nick || '*', params: 'AUTHENTICATE', message: 'You have already authenticated' });
            return next();
        }

        if (!this._authenticating) {
            switch (params[0].trim().toUpperCase()) {
                case 'PLAIN':
                    this.send('AUTHENTICATE +');
                    this._authenticating = true;
                    return next();

                default:
                    this.send({ verb: 'RPL_SASLMECHS', target: this.session.nick || '*', params: 'PLAIN', message: 'are the available SASL mechanisms' });
                    this.send({ verb: 'ERR_SASLFAIL', target: this.session.nick || '*', message: 'SASL authentication failed' });
                    return next();
            }
        }

        let auth = params[0].trim();
        if (auth === '*') {
            this._authenticating = false;
            this.send({ verb: 'ERR_SASLABORTED', target: this.session.nick || '*', message: 'SASL authentication aborted' });
            return next();
        }

        let parts = Buffer.from(auth, 'base64')
            .toString()
            .split('\x00');

        //let nick = parts[0] || this.session.nick;
        let user = parts[1] || this.session.nick;
        let password = parts[2] || '';

        this.authenticate(user, password, (err, auth) => {
            this._authenticating = false;
            if (err) {
                this.server.quit(this, 'User registration failed. ' + err.message);
                return this.close();
            }
            if (auth) {
                this.session.auth = auth;
                this.send({
                    verb: 'RPL_LOGGEDIN',
                    target: this.session.nick || '*',
                    params: [this.getFormattedName(), this.session.user],
                    message: 'You are now logged in as ' + this.session.user
                });
                this.send({ verb: 'RPL_SASLSUCCESS', target: this.session.nick || '*', message: 'SASL authentication successful' });
                return this.verifyNickChange(false, next);
            } else {
                this.send({ verb: 'ERR_SASLFAIL', target: this.session.nick || '*', message: 'SASL authentication failed' });
            }
            return next();
        });

        this._authenticating = false;

        return next();
    }

    command_NN(params, next) {
        this.session.nick = params[0];
        this.server.nick(this);
        next();
    }
}

module.exports = IRCConnection;
