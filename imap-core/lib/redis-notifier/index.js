'use strict';

let redis = require('redis');
let EventEmitter = require('events').EventEmitter;
let crypto = require('crypto');
let fs = require('fs');
let scripts = {
    addEntries: fs.readFileSync(__dirname + '/add-entries.lua')
};

// Assumes that there are following hash keys in Redis:
//   u:[username]:folder:[md5(path)]
// with the following key:
//   modifyIndex: Number

class RedisNotifier extends EventEmitter {

    constructor(options) {
        super();

        options = options || {};

        this.options = {
            port: options.port || 6379,
            host: options.host || 'localhost',
            db: options.db || 0,
            prefix: options.prefix || 'imap:'
        };

        let logfunc = (...args) => {
            let level = args.shift() || 'DEBUG';
            let message = args.shift() || '';

            console.log([level].concat(message || '').join(' '), ...args); // eslint-disable-line no-console
        };

        this.logger = options.logger || {
            info: logfunc.bind(null, 'INFO'),
            debug: logfunc.bind(null, 'DEBUG'),
            error: logfunc.bind(null, 'ERROR')
        };

        // we need two db connections as subscriber can't manage data
        this._db = redis.createClient(options.port, options.host);
        this._subscriber = redis.createClient(options.port, options.host);

        this._pubsubListeners = new Map();
        this._listeners = new EventEmitter();
        this._listeners.setMaxListeners(0);

        this._subscriber.on('message', (channel, message) => {
            try {
                message = JSON.parse(message);
            } catch (E) {
                // ignore
            }
            this.logger.debug(
                'Journal update notification for %s, updating %s subscribers',
                channel.slice(this.options.prefix.length),
                this._listeners.listenerCount(channel.slice(this.options.prefix.length)));

            this._listeners.emit(channel.slice(this.options.prefix.length), message);
        });

        EventEmitter.call(this);
    }

    /**
     * Generates hashed event names for mailbox:username pairs
     *
     * @param {String} username
     * @param {String} mailbox
     * @returns {String} md5 hex
     */
    _eventName(username, mailbox) {
        return crypto.createHash('md5').update(username + ':' + mailbox).digest('hex');
    }

    /**
     * Registers an event handler for mailbox:username events
     *
     * @param {String} username
     * @param {String} mailbox
     * @param {Function} handler Function to run once there are new entries in the journal
     */
    addListener(session, mailbox, handler) {
        let eventName = this._eventName(session.user.username, mailbox);
        this._listeners.addListener(eventName, handler);

        if (!this._pubsubListeners.has(eventName)) {
            this._pubsubListeners.set(eventName, 1);
            this._subscriber.subscribe(this.options.prefix + eventName);
        } else {
            this._pubsubListeners.set(eventName, this._pubsubListeners.get(eventName) + 1);
        }

        this.logger.debug('New journal listener for %s ("%s:%s", total %s subscribers)', eventName, session.user.username, mailbox, this._listeners.listenerCount(eventName));
    }

    /**
     * Unregisters an event handler for mailbox:username events
     *
     * @param {String} username
     * @param {String} mailbox
     * @param {Function} handler Function to run once there are new entries in the journal
     */
    removeListener(session, mailbox, handler) {
        let count, eventName = this._eventName(session.user.username, mailbox);
        this._listeners.removeListener(eventName, handler);

        if (this._pubsubListeners.has(eventName) && (count = this._pubsubListeners.get(eventName)) && count > 0) {
            count--;
            if (!count) {
                this._subscriber.unsubscribe(this.options.prefix + eventName);
                this._pubsubListeners.delete(eventName);
            } else {
                this._pubsubListeners.set(eventName, 1);
            }

            this.logger.debug('Removed journal listener from %s ("%s:%s", total %s subscribers)', eventName, session.user.username, mailbox, this._listeners.listenerCount(eventName));
        }
    }

    /**
     * Stores multiple journal entries to db
     *
     * @param {String} username
     * @param {String} mailbox
     * @param {Array|Object} entries An array of entries to be journaled
     * @param {Function} callback Runs once the entry is either stored or an error occurred
     */
    addEntries(username, mailbox, entries, callback) {
        let mailboxHash = crypto.createHash('md5').update(mailbox).digest('hex');

        if (entries && !Array.isArray(entries)) {
            entries = [entries];
        } else if (!entries || !entries.length) {
            return callback(null, false);
        }

        entries = entries.map(entry => JSON.stringify(entry));

        this.logger.debug('Adding journal entries for %s (%s)\n%s', mailbox, mailboxHash, entries.join('\n'));

        this._db.multi().
        select(this.options.db).
        eval([
            scripts.addEntries,
            2,
            'u:' + username + ':folder:' + mailboxHash,
            'u:' + username + ':journal:' + mailboxHash
        ].concat(entries)).
        exec(err => {
            if (err) {
                return callback(err);
            }

            return callback(null, true);
        });
    }

    /**
     * Sends a notification that there are new updates in the selected mailbox
     *
     * @param {String} username
     * @param {String} mailbox
     */
    fire(username, mailbox, payload) {
        let eventName = this._eventName(username, mailbox);

        payload = payload || false;

        setImmediate(this._db.publish.bind(this._db, this.options.prefix + eventName, JSON.stringify(payload)));
    }

    /**
     * Returns all entries from the journal that have higher than provided modification index
     *
     * @param {String} username
     * @param {String} mailbox
     * @param {Number} modifyIndex Last known modification id
     * @param {Function} callback Returns update entries as an array
     */
    getUpdates(session, mailbox, modifyIndex, callback) {
        modifyIndex = Number(modifyIndex) || 0;

        let mailboxHash = crypto.createHash('md5').update(mailbox).digest('hex');
        let username = session.user.username;

        this._db.multi().
        select(this.options.db).
        exists('u:' + username + ':journal:' + mailboxHash).
        zrangebyscore('u:' + username + ':journal:' + mailboxHash, modifyIndex + 1, Infinity).
        exec((err, replies) => {
            let updates;

            this.logger.debug('[%s] Loaded journal updates for "%s:%s" since %s', session.id, username, mailbox, modifyIndex + 1);

            if (err) {
                return callback(err);
            }
            if (!replies || !replies[1]) {
                return callback(null, 'NONEXISTENT');
            }

            updates = (replies[2] || []).
            map(entry => {
                let data;
                let m = (entry || '').toString().match(/^(\d+)\:/);

                if (!m) {
                    // invalidly formatted entry
                    this.logger.debug('[%s] Invalidly formatted entry for "%s:%s" (%s)', session.id, username, mailbox, (entry).toString());
                    return false;
                }

                try {
                    data = JSON.parse(entry.substr(m[0].length));
                    data.modseq = Number(m[1]) || false;
                    // we mess around with json in redis lua but lua does not make
                    // a distinction between an object and an array, if an array
                    // is empty then it will be invalidly detected as an object
                    if (data.flags && !Array.isArray(data.flags)) {
                        data.flags = [];
                    }
                } catch (E) {
                    this.logger.error('[%s] Failed parsing journal update for "%s:%s" (%s): %s', session.id, username, mailbox, entry.substr(m[0].length), E.message);
                }

                return data;
            }).filter(entry =>
                // only include entries with data
                (entry && entry.uid)
            );

            this.logger.debug('[%s] Processing journal updates for "%s:%s": %s', session.id, username, mailbox, JSON.stringify(updates));

            callback(null, updates);
        });
    }

}

module.exports = RedisNotifier;
