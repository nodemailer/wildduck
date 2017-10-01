'use strict';

const dns = require('dns');
const crypto = require('crypto');
const EventEmitter = require('events');
const os = require('os');
const codes = require('./codes');
const db = require('../db');
const ObjectID = require('mongodb').ObjectID;

const PING_TIMEOUT = 10 * 120 * 1000;
const SOCKET_TIMEOUT = 5 * 60 * 1000;

class IRCConnection extends EventEmitter {
    constructor(server, socket) {
        super();
        this.server = server;
        this._socket = socket;

        this._closed = false;
        this._closing = false;

        this._authenticating = false;

        this.subscriptions = new Set();

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

        this.accumulateTimer = false;
        this.accumulateStart = false;
        this.fetching = false;
        this.dofetch = false;
        this.lastFetchedItem = new ObjectID();

        this.subscriber = data => {
            switch (data.action) {
                case 'message': {
                    clearTimeout(this.accumulateTimer);
                    let time = Date.now();
                    if (this.accumulateStart && this.accumulateStart < time - 1000) {
                        this.accumulateStart = false;
                        return this.fetchMessages();
                    }
                    if (!this.accumulateStart) {
                        this.accumulateStart = time;
                    }
                    this.accumulateTimer = setTimeout(() => this.fetchMessages(), 80);
                    this.accumulateTimer.unref();
                    break;
                }

                case 'nick': {
                    if (data.session === this.session.id.toString()) {
                        // same session
                        break;
                    }

                    if (data.user === this.session.auth.id.toString()) {
                        let currentSource = this.getFormattedName();
                        this.session.nick = data.nick;
                        this.send({ source: currentSource, verb: 'NICK', target: false, params: this.session.nick });
                    } else {
                        this.send({ source: data.old, verb: 'NICK', target: false, params: data.nick });
                    }

                    break;
                }

                case 'join': {
                    if (data.session === this.session.id.toString()) {
                        // same session
                        break;
                    }

                    if (data.user === this.session.auth.id.toString()) {
                        let subscriptionKey = [this.session.ns, '#', data.channelId].join('.');
                        if (!this.subscriptions.has(subscriptionKey)) {
                            this.subscribe(subscriptionKey);
                            this.send({ source: this.getFormattedName(), verb: 'JOIN', target: false, message: data.channel });
                        }
                    } else {
                        this.send({ source: data.nick, verb: 'JOIN', target: false, message: data.channel });
                    }

                    break;
                }

                case 'part': {
                    if (data.session === this.session.id.toString()) {
                        // same session
                        break;
                    }

                    if (data.user === this.session.auth.id.toString()) {
                        let subscriptionKey = [this.session.ns, '#', data.channelId].join('.');
                        if (this.subscriptions.has(subscriptionKey)) {
                            this.unsubscribe(subscriptionKey);
                            this.send({ source: this.getFormattedName(), verb: 'PART', target: false, message: data.channel });
                        }
                    } else {
                        this.send({ source: data.nick, verb: 'PART', target: false, message: data.channel });
                    }

                    break;
                }

                case 'topic': {
                    this.send({ time: data.topicTime, source: data.topicAuthor, verb: 'TOPIC', target: data.channel, message: data.topic });
                    break;
                }
            }
        };
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

    fetchMessages(force) {
        if (!force && this.fetching) {
            this.dofetch = true;
            return false;
        }
        this.fetching = true;
        this.dofetch = false;

        let query = {
            _id: { $gt: this.lastFetchedItem },
            rcpt: this.session.auth.id
        };

        let cursor = db.database.collection('chat').find(query);

        let clear = () =>
            cursor.close(() => {
                db.redis.hset('irclast', this.session.auth.id.toString(), this.lastFetchedItem.toString(), () => {
                    if (this.dofetch) {
                        return setImmediate(() => this.fetchMessages(true));
                    } else {
                        this.fetching = false;
                    }
                });
            });

        let processNext = () => {
            cursor.next((err, message) => {
                if (err) {
                    this.server.logger.error(
                        {
                            err,
                            tnx: 'chat',
                            cid: this.id
                        },
                        'Failed iterating db cursor. %s',
                        err.message
                    );
                    return;
                }
                if (!message) {
                    return clear();
                }
                this.lastFetchedItem = message._id;

                if (message.session.toString() === this.session.id.toString() && !this.capEnabled.has('echo-message')) {
                    // ignore messages from self unless echo-message
                    return setImmediate(processNext);
                }

                let payload = {
                    time: message.time,
                    source: message.nick,
                    verb: 'PRIVMSG',
                    message: message.message
                };

                if (message.type === 'channel') {
                    payload.target = message.channel.name;
                    this.send(payload);
                    return setImmediate(processNext);
                }

                db.database.collection('nicks').findOne({
                    user: new ObjectID(message.target)
                }, (err, nickData) => {
                    if (err) {
                        // ignore, not important
                    }

                    if (nickData) {
                        payload.target = nickData.nick;
                    } else {
                        payload.target = message.targetNick;
                    }

                    this.send(payload);
                    return setImmediate(processNext);
                });
            });
        };

        processNext();
    }

    send(payload) {
        if (!this._socket || !this._socket.writable) {
            return;
        }

        if (payload && typeof payload === 'object') {
            let message = [];

            let verb = (payload.verb || '')
                .toString()
                .toUpperCase()
                .trim();

            let tags = payload.tags;
            if (tags && !Array.isArray(tags) && typeof tags === 'object') {
                tags = Object.keys(tags || {}).forEach(key => ({
                    key,
                    value: tags[key]
                }));
            }
            tags = [].concat(tags || []);

            if (['PRIVMSG', 'NOTICE'].includes(verb.toUpperCase())) {
                let time = payload.time ? (typeof payload.time !== 'object' ? new Date(payload.time) : payload.time) : new Date();

                if (this.capEnabled.has('server-time')) {
                    tags.push({
                        key: 'time',
                        value: time.getISOString()
                    });
                } else if (this.capEnabled.has('znc.in/server-time')) {
                    tags.push({
                        key: 't',
                        value: Math.round(time.getTime() / 1000)
                    });
                }
            }

            if (tags.length) {
                let tagStr = tags
                    .map(tag => {
                        if (typeof tag.value === 'boolean') {
                            if (tag.value === true) {
                                return tag.key;
                            }
                            return;
                        }
                        return (
                            tag.key +
                            '=' +
                            (tag.value || '').toString().replace(/[;\r\n\\ ]/g, c => {
                                switch (c) {
                                    case ';':
                                        return '\\:';
                                    case '\r':
                                        return '\\r';
                                    case '\n':
                                        return '\\n';
                                    case ' ':
                                        return '\\s';
                                }
                            })
                        );
                    })
                    .join(';');
                if (tagStr.length) {
                    message.push('@' + tagStr);
                }
            }

            payload.source = payload.source || this.hostname;
            message.push(':' + payload.source);

            if (verb) {
                message.push(codes.has(verb) ? codes.get(verb) : verb);
            }

            if (payload.target) {
                message.push(payload.target);
            } else if (payload.target !== false) {
                message.push(this.session.nick || this.id);
            }

            if (payload.params) {
                message = message.concat(payload.params || []);
            }

            if (payload.message || typeof payload.message === 'string') {
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
        this.subscriptions.forEach(subscriptionKey => {
            this.unsubscribe(subscriptionKey);
        });
        this.subscriptions.clear();

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
            id: new ObjectID(),
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

        let match = line.match(/^\s*(?:@([^\s]+)\s+)?(?::([^\s]+)\s+)?([^\s]+)\s*/);
        if (!match) {
            // TODO: send error message
            // Can it even happen?
            return this.processQueue();
        }

        let tags = !match[1] ? false : new Map();
        (match[1] || '')
            .toString()
            .split(';')
            .forEach(elm => {
                if (!elm) {
                    return;
                }
                let eqPos = elm.indexOf('=');
                if (eqPos < 0) {
                    tags.set(elm, true);
                    return;
                }

                let key = elm.substr(0, eqPos);
                let value = elm.substr(eqPos + 1).replace(/\\(.)/g, (m, c) => {
                    switch (c) {
                        case ':':
                            return ';';
                        case 's':
                            return ' ';
                        case '\\':
                            return '\\';
                        case 'r':
                            return '\r';
                        case 'n':
                            return '\n';
                        default:
                            return c;
                    }
                });
                tags.set(key, value);
            });

        let prefix = (match[3] || '').toString() || false;
        let verb = (match[3] || '').toString().toUpperCase();
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
        if (data || typeof data === 'string') {
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
            this['command_' + verb](tags, prefix, params, () => {
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

    printNickList(channelData, fresh, next) {
        db.database
            .collection('nicks')
            .find({
                user: { $in: channelData.members }
            })
            .project({
                _id: true,
                nick: true,
                user: true
            })
            .toArray((err, nickList) => {
                if (err) {
                    this.send({ verb: 'ERR_FILEERROR', params: channelData.channel, message: err.message });
                    return next();
                }

                if (!nickList) {
                    nickList = [];
                }

                if (fresh) {
                    nickList.unshift({
                        nick: this.session.nick
                    });
                }

                let lines = [];
                let curLine = { members: [], length: 0 };
                nickList.forEach(nickData => {
                    curLine.members.push(nickData.nick);
                    curLine.length += nickData.nick.length + 1;
                    if (curLine.length > 400) {
                        lines.push(curLine);
                        curLine = { members: [], length: 0 };
                    }
                });
                if (curLine.length) {
                    lines.push(curLine);
                }

                this.send({ source: this.getFormattedName(), verb: 'JOIN', target: false, message: channelData.channel });

                if (channelData.topic) {
                    let topicTime = Math.round((channelData.topicTime || new Date()).getTime() / 1000);
                    this.send({ verb: 'RPL_TOPIC', params: channelData.channel, message: channelData.topic });
                    this.send({ verb: 'RPL_TOPICWHOTIME', params: [channelData.channel, channelData.topicAuthor, topicTime] });
                }

                lines.forEach(line => {
                    this.send({ verb: 'RPL_NAMREPLY', params: ['=', channelData.channel], message: line.members.join(' ') });
                });

                this.send({ verb: 'RPL_ENDOFNAMES', params: channelData.channel, message: 'End of /NAMES list' });

                next();
            });
    }

    getFormattedName(skipNick, nick) {
        nick = nick || this.session.nick;
        return (!skipNick && nick ? nick + '!' : '') + (this.session.user || 'unknown') + '@' + this.session.clientHostname;
    }

    checkSessionStart(next) {
        if (this.starting || this.started) {
            return setImmediate(next);
        }
        if (!this.session.user || !this.session.nick || (this.capStarted && !this.capEnded)) {
            return setImmediate(next);
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

        this.starting = false;
        this.started = true;

        if (!this.session.auth) {
            this.send({
                source: 'NickServ!NickServ@services.',
                verb: 'NOTICE',
                message: 'This server requires all users to be authenticated. Identify via /msg NickServ identify <password>'
            });
            return setImmediate(next);
        } else {
            this.initializeSubscriptions(next);
        }
    }

    initializeSubscriptions(next) {
        next = next || (() => false);
        db.database
            .collection('channels')
            .find({
                members: this.session.auth.id
            })
            .project({
                _id: true,
                channel: true,
                members: true,
                topic: true,
                topicTime: true,
                topicAuthor: true
            })
            .toArray((err, channels) => {
                if (err) {
                    this.server.logger.error(
                        {
                            err,
                            tnx: 'setup',
                            cid: this.id,
                            user: this.session.auth.id
                        },
                        'Failed loading channels. %s',
                        err.message
                    );
                    return next();
                }
                if (Array.isArray(channels)) {
                    channels.forEach(channelData => {
                        this.server.logger.info(
                            {
                                tnx: 'setup',
                                cid: this.id,
                                channel: channelData._id
                            },
                            'Joining %s to channel %s',
                            this.session.auth.id,
                            channelData._id
                        );

                        this.subscribe([this.session.ns, '#', channelData._id].join('.'));
                        this.printNickList(channelData, false, next);
                        //this.send({ source: this.getFormattedName(), verb: 'JOIN', target: false, message: channelData.channel });
                    });
                }

                // private messages
                this.subscribe([this.session.ns, '%', this.session.auth.id].join('.'));

                // general notifications
                this.subscribe([this.session.ns, '!', '*'].join('.'));

                this.fetchMessages();

                return next();
            });
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
                    db.redis.hget('irclast', userData._id.toString(), (err, ircLast) => {
                        if (err) {
                            // ignore
                        }

                        if (ircLast) {
                            let lastFetchedItem = new ObjectID(ircLast);
                            let maxAge = Math.round(Date.now() / 1000 - 2 * 24 * 3600);
                            if (lastFetchedItem.getTimestamp().getTime() < maxAge * 1000) {
                                lastFetchedItem = new ObjectID(maxAge);
                            }
                            this.lastFetchedItem = lastFetchedItem;
                        }

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
                });
            }
        );
    }

    getNick(nick, next) {
        let ns = this.session.ns;
        let nickview = nick.toLowerCase().replace(/\./g, '');
        let user = this.session.auth.id;

        let nickInfo = {
            action: 'nick',
            user,
            changed: false,
            nick,
            session: this.session.id.toString()
        };

        db.database.collection('nicks').findOne({
            ns,
            nickview: { $ne: nickview },
            user
        }, (err, existingData) => {
            if (err) {
                // ignore, not important
            }

            if (existingData) {
                nickInfo.old = this.getFormattedName(false, existingData.nick);
                nickInfo.changed = true;
            }

            db.database.collection('nicks').findOne({
                ns,
                nickview
            }, (err, nickData) => {
                if (err) {
                    if (existingData && existingData.nick) {
                        err.existingNick = existingData.nick;
                    }
                    return next(err);
                }

                if (nickData) {
                    if (nickData.user.toString() === user.toString()) {
                        nickInfo.id = nickData._id;
                        return next(null, nickInfo);
                    }

                    err = new Error('Requested nick is already in use');
                    err.verb = 'ERR_NICKNAMEINUSE ';
                    if (existingData && existingData.nick) {
                        err.existingNick = existingData.nick;
                    }
                    return next(err);
                }

                db.database.collection('nicks').insertOne({
                    ns,
                    nickview,
                    nick,
                    user
                }, (err, r) => {
                    if (err) {
                        if (err.code === 11000) {
                            err = new Error('Race condition in acquireing nick');
                            err.verb = 'ERR_NICKNAMEINUSE ';
                            if (existingData && existingData.nick) {
                                err.existingNick = existingData.nick;
                            }
                            return next(err);
                        }
                        return next(err);
                    }

                    let insertId = r && r.insertedId;
                    if (!insertId) {
                        let err = new Error('Failed to set up nick');
                        if (existingData && existingData.nick) {
                            err.existingNick = existingData.nick;
                        }
                        return next(err);
                    }

                    nickInfo.id = insertId;

                    if (existingData) {
                        // try to remove old nicks
                        db.database.collection('nicks').deleteOne({
                            _id: existingData._id
                        }, () => next(null, nickInfo));
                    } else {
                        next(null, nickInfo);
                    }
                });
            });
        });
    }

    verifyNickChange(currentSource, next) {
        this.getNick(this.session.nick, (err, nickInfo) => {
            if (err) {
                currentSource = currentSource || this.getFormattedName();
                this.send({ verb: err.verb || 'ERR_UNAVAILRESOURCE', params: this.session.nick, message: err.message });
                this.session.nick = err.existingNick || 'user' + this.id;

                if (currentSource && currentSource !== this.getFormattedName()) {
                    this.send({ source: currentSource, verb: 'NICK', target: false, params: this.session.nick });
                }

                return next();
            }

            if (nickInfo.changed) {
                this.publish(this.session.ns + '.!.nick', nickInfo);
            }

            return next();
        });
    }

    subscribe(subscriptionKey) {
        this.subscriptions.add(subscriptionKey);
        this.server.subscribe(this, subscriptionKey, this.subscriber);
    }

    unsubscribe(subscriptionKey) {
        this.subscriptions.delete(subscriptionKey);
        this.server.unsubscribe(this, subscriptionKey);
    }

    publish(subscriptionKey, data) {
        this.server.publish(this, subscriptionKey, data);
    }

    checkAuth() {
        if (!this.session.auth) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'Authentication required to chat in this server' });
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
                this.close();
            }, PING_TIMEOUT);
        }, PING_TIMEOUT);
    }

    command_QUIT() {
        this.send('ERROR :Closing link: (' + this.getFormattedName(true) + ') [Client exited]');
        this.close();
    }

    command_PING(tags, prefix, params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'PING', message: 'Not enough parameters' });
            return next();
        }
        if (!this.session.user) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'You have not registered' });
            return next();
        }
        let host = params[0] || this.session.clientHostname;
        this.send({ verb: 'PONG', target: this.hostname, message: host });
        return next();
    }

    command_PONG(tags, prefix, params, next) {
        return next();
    }

    command_NICK(tags, prefix, params, next) {
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

        if (this.session.auth) {
            this.verifyNickChange(currentSource, () => this.checkSessionStart(next));
        } else {
            this.checkSessionStart(next);
        }
    }

    command_PASS(tags, prefix, params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'PASS', message: 'Not enough parameters' });
            return next();
        }

        let pass = params.join(' ');

        this.connectionPass = pass;

        return next();
    }

    command_USER(tags, prefix, params, next) {
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
                if (err || !auth) {
                    let message = err ? err.message : 'Authentication failed';
                    this.send('ERROR :Closing link: (' + this.getFormattedName(true) + ') [' + message + ']');
                    return this.close();
                }
                this.session.auth = auth;
                return this.verifyNickChange(false, () => this.checkSessionStart(next));
            });
        } else {
            return this.checkSessionStart(next);
        }
    }

    command_JOIN(tags, prefix, params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'You have not registered' });
            return next();
        }
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'JOIN', message: 'Not enough parameters' });
            return next();
        }

        if (!this.checkAuth()) {
            return next();
        }

        let channels = params[0]
            .split(',')
            .map(channel => channel.trim())
            .filter(channel => channel);

        if (channels.length === 1 && channels[0] === '0') {
            // TODO: leave all channels
            return next();
        }

        let channelPos = 0;
        let processNext = () => {
            if (channelPos >= channels.length) {
                return next();
            }

            let channel = channels[channelPos++];
            if (channel.length < 2 || !/^[#&]/.test(channel) || /[#&\s]/.test(channel.substr(1)) || /^[#&]\.+$/.test(channel)) {
                this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'Invalid channel name' });
                return setImmediate(processNext);
            }

            let channelview = channel.toLowerCase().replace(/\./g, '');

            let sendJoinMessages = (channelData, fresh, done) => {
                let idString = this.session.auth.id.toString();

                let eventData = {
                    action: 'join',
                    channel: channelData.channel,
                    session: this.session.id.toString(),
                    channelId: channelData._id.toString(),
                    user: idString,
                    nick: this.getFormattedName()
                };

                if (fresh) {
                    // notify channel members
                    this.publish([this.session.ns, '#', channelData._id].join('.'), eventData);
                }

                // notify other instances of self
                this.publish([this.session.ns, '%', idString].join('.'), eventData);
                this.printNickList(channelData, fresh, done);
            };

            let tryCount = 0;
            let tryGetChannel = () => {
                db.database.collection('channels').findOne({
                    ns: this.session.ns,
                    channelview
                }, {
                    fields: {
                        _id: true,
                        channel: true,
                        topic: true,
                        topicTime: true,
                        topicAuthor: true
                    }
                }, (err, channelData) => {
                    if (err) {
                        this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                        return setImmediate(processNext);
                    }

                    if (channelData) {
                        return db.database.collection('channels').findOneAndUpdate({
                            _id: channelData._id
                        }, {
                            $addToSet: {
                                members: this.session.auth.id
                            }
                        }, {
                            returnOriginal: true
                        }, (err, result) => {
                            if (err) {
                                this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                                return setImmediate(processNext);
                            }

                            if (!result || !result.value) {
                                this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'Could not open channel' });
                                return setImmediate(processNext);
                            }

                            channelData = result.value;

                            this.subscribe([this.session.ns, '#', channelData._id].join('.'));

                            let idString = this.session.auth.id.toString();
                            if (!result.value.members.find(member => member.toString() === idString)) {
                                // new join!
                                return sendJoinMessages(channelData, true, processNext);
                            }

                            sendJoinMessages(channelData, false, processNext);
                        });
                    }

                    let time = new Date();
                    channelData = {
                        _id: new ObjectID(),
                        channel,
                        channelview,
                        ns: this.session.ns,
                        mode: [],
                        owner: this.session.auth.id,
                        members: [this.session.auth.id],
                        time,
                        topic: '',
                        topicTime: time,
                        topicAuthor: ''
                    };

                    db.database.collection('channels').insertOne(channelData, err => {
                        if (err) {
                            if (err.code === 11000 && tryCount++ < 5) {
                                return setTimeout(tryGetChannel, 100);
                            }
                            this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                            return setImmediate(processNext);
                        }

                        this.subscribe([this.session.ns, '#', channelData._id].join('.'));

                        sendJoinMessages(channelData, false, processNext);
                    });
                });
            };
            tryGetChannel();
        };
        processNext();
    }

    command_PART(tags, prefix, params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'You have not registered' });
            return next();
        }
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'PART', message: 'Not enough parameters' });
            return next();
        }

        if (!this.checkAuth()) {
            return next();
        }

        let channels = params[0]
            .split(',')
            .map(channel => channel.trim())
            .filter(channel => channel);
        //let reason = params[1] || '';

        if (channels.length === 1 && channels[0] === '0') {
            // TODO: leave all channels
            return next();
        }

        let channelPos = 0;
        let processNext = () => {
            if (channelPos >= channels.length) {
                return next();
            }

            let channel = channels[channelPos++];

            if (channel.length < 2 || !/^[#&]/.test(channel) || /[#&\s]/.test(channel.substr(1))) {
                this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'No such channel' });
                return setImmediate(processNext);
            }

            db.database.collection('channels').findOneAndUpdate({
                ns: this.session.ns,
                channelview: channel.toLowerCase().replace(/\./g, ''),
                members: this.session.auth.id
            }, {
                $pull: {
                    members: this.session.auth.id
                }
            }, {
                returnOriginal: false
            }, (err, result) => {
                if (err) {
                    this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                    return setImmediate(processNext);
                }

                if (!result || !result.value) {
                    this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'No such channel' });
                    return setImmediate(processNext);
                }

                let channelData = result.value;

                let eventData = {
                    action: 'part',
                    channel: channelData.channel,
                    session: this.session.id.toString(),
                    channelId: channelData._id.toString(),
                    user: this.session.auth.id.toString(),
                    nick: this.getFormattedName()
                };

                this.send({ source: this.getFormattedName(), verb: 'PART', target: false, message: channelData.channel });

                let subscriptionKey = [this.session.ns, '#', channelData._id].join('.');
                // notify channel members
                this.publish(subscriptionKey, eventData);
                this.unsubscribe(subscriptionKey);

                return setImmediate(processNext);
            });
        };
        processNext();
    }

    command_PRIVMSG(tags, prefix, params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'You have not registered' });
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
                tags,
                prefix,
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

        let resolveTarget = done => {
            if (/^[#&\s]/.test(target)) {
                // channel
                db.database.collection('channels').findOne({
                    ns: this.session.ns,
                    channelview: target.toLowerCase().replace(/\./g, '')
                }, (err, channelData) => {
                    if (err) {
                        this.send({ verb: 'ERR_FILEERROR', params: target, message: err.message });
                        return next();
                    }

                    if (!channelData) {
                        this.send({ verb: 'ERR_NOSUCHCHANNEL', params: target, message: 'No such channel' });
                        return next();
                    }

                    done(false, {
                        type: 'channel',
                        channel: channelData,
                        target: channelData._id.toString(),
                        targets: channelData.members || []
                    });
                });
            } else {
                // nick
                // channel
                db.database.collection('nicks').findOne({
                    ns: this.session.ns,
                    nickview: target.toLowerCase().replace(/\./g, '')
                }, (err, nickData) => {
                    if (err) {
                        this.send({ verb: 'ERR_FILEERROR', params: target, message: err.message });
                        return next();
                    }

                    if (!nickData) {
                        this.send({ verb: 'ERR_NOSUCHNICK', params: target, message: 'No such nick/channel' });
                        return next();
                    }

                    done(false, {
                        type: 'nick',
                        nick: nickData,
                        target: nickData.user.toString(),
                        targets: [nickData.user].concat(nickData.user.toString() !== this.session.auth.id.toString() ? this.session.auth.id : [])
                    });
                });
            }
        };

        resolveTarget((err, targetData) => {
            if (err) {
                this.send({ verb: 'ERR_FILEERROR', params: target, message: err.message });
                return next();
            }

            let msgId = new ObjectID();
            let time = new Date();
            let message = params.slice(1).join(' ');
            let channel = (targetData.type === 'channel' && { id: targetData.channel._id, name: targetData.channel.channel }) || false;
            let inserts = targetData.targets.map(user => {
                let entry = {
                    insertOne: {
                        msgId,
                        channel,
                        targetNick: targetData.type === 'nick' ? targetData.nick.nick : false,
                        type: targetData.type,
                        target: targetData.target,
                        session: this.session.id,
                        ns: this.session.ns,
                        from: this.session.auth.id,
                        nick: this.getFormattedName(),
                        rcpt: user,
                        time,
                        message
                    }
                };
                return entry;
            });

            db.database.collection('chat').bulkWrite(inserts, { ordered: false }, err => {
                if (err) {
                    this.send({ verb: 'ERR_FILEERROR', params: target, message: err.message });
                    return next();
                }

                if (channel) {
                    this.publish([this.session.ns, '#', channel.id].join('.'), {
                        action: 'message',
                        msgId: msgId.toString()
                    });
                } else {
                    targetData.targets.map(user => {
                        this.publish([this.session.ns, '%', user].join('.'), {
                            action: 'message',
                            msgId: msgId.toString()
                        });
                    });
                }
                return next();
            });
        });
    }

    command_CAP(tags, prefix, params, next) {
        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', target: this.session.nick || '*', params: 'CAP', message: 'Not enough parameters' });
            return next();
        }

        let allowed = ['sasl', 'server-time', 'znc.in/server-time', 'echo-message'];

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

                return this.checkSessionStart(next);
        }
        next();
    }

    command_NICKSERV(tags, prefix, params, next) {
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
                        this.send('ERROR :Closing link: (' + this.getFormattedName(true) + ') [' + err.message + ']');
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
                        return this.verifyNickChange(false, () => this.initializeSubscriptions(next));
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

    command_AUTHENTICATE(tags, prefix, params, next) {
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
                this.send('ERROR :Closing link: (' + this.getFormattedName(true) + ') [' + err.message + ']');
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

    command_MODE(tags, prefix, params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'You have not registered' });
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

        if (params.length > 1) {
            this.send({ verb: 'ERR_CHANOPRIVSNEEDED', params: channel, message: 'You are not channel operator' });
            return next();
        }

        db.database.collection('channels').findOne({
            ns: this.session.ns,
            channelview: channel.toLowerCase().replace(/\./g, '')
        }, {
            fields: {
                _id: true,
                mode: true,
                time: true
            }
        }, (err, channelData) => {
            if (err) {
                this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                return next();
            }

            if (!channelData) {
                this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'No such channel' });
                return next();
            }

            let channelTime = Math.round((channelData.time || new Date()).getTime() / 1000);

            this.send({ verb: 'RPL_CHANNELMODEIS', params: [channel, '+'] });
            this.send({ verb: 'RPL_CREATIONTIME', params: [channel, channelTime] });

            return next();
        });
    }

    command_TOPIC(tags, prefix, params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'You have not registered' });
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

        let newTopic = params
            .slice(1)
            .join(' ')
            .trim();

        if (params.length < 2) {
            db.database.collection('channels').findOne({
                ns: this.session.ns,
                channelview: channel.toLowerCase().replace(/\./g, '')
            }, {
                fields: {
                    _id: true,
                    topic: true,
                    topicTime: true,
                    topicAuthor: true
                }
            }, (err, channelData) => {
                if (err) {
                    this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                    return next();
                }

                if (!channelData) {
                    this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'No such channel' });
                    return next();
                }

                if (!channelData.topic) {
                    this.send({ verb: 'RPL_NOTOPIC', params: channel, message: 'No topic is set' });
                    return next();
                }

                let topicTime = Math.round((channelData.topicTime || new Date()).getTime() / 1000);

                this.send({ verb: 'RPL_TOPIC', params: channel, message: channelData.topic });
                this.send({ verb: 'RPL_TOPICWHOTIME', params: [channel, channelData.topicAuthor, topicTime] });

                return next();
            });
        } else {
            let topicTime = new Date();
            let topicAuthor = this.getFormattedName();

            return db.database.collection('channels').findOneAndUpdate({
                ns: this.session.ns,
                channelview: channel.toLowerCase().replace(/\./g, '')
            }, {
                $set: {
                    topic: newTopic,
                    topicAuthor,
                    topicTime
                }
            }, {
                returnOriginal: false
            }, (err, result) => {
                if (err) {
                    this.send({ verb: 'ERR_FILEERROR', params: channel, message: err.message });
                    return next();
                }

                if (!result || !result.value) {
                    this.send({ verb: 'ERR_NOSUCHCHANNEL', params: channel, message: 'Could not open channel' });
                    return next();
                }

                let channelData = result.value;

                this.publish([this.session.ns, '#', channelData._id].join('.'), {
                    action: 'topic',
                    channel: channelData.channel,
                    session: this.session.id.toString(),
                    channelId: channelData._id.toString(),
                    topic: newTopic,
                    topicAuthor,
                    topicTime
                });
                next();
            });
        }
    }

    command_OPER(tags, prefix, params, next) {
        if (!this.session.user || !this.session.nick) {
            this.send({ verb: 'ERR_NOTREGISTERED', message: 'You have not registered' });
            return next();
        }

        if (!params.length) {
            this.send({ verb: 'ERR_NEEDMOREPARAMS', params: 'OPER', message: 'Not enough parameters' });
            return next();
        }

        if (!this.checkAuth()) {
            return next();
        }

        this.send({ verb: 'ERR_NOOPERHOST', message: 'No O-lines for your host' });
        return next();
    }
}

module.exports = IRCConnection;
