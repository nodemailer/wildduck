'use strict';

const crypto = require('crypto');
const EventEmitter = require('events').EventEmitter;
const redis = require('redis');

class ImapNotifier extends EventEmitter {

    constructor(options) {
        super();

        this.database = options.database;

        this.subsriber = redis.createClient();
        this.publisher = redis.createClient();

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

        this._listeners = new EventEmitter();
        this._listeners.setMaxListeners(0);

        let publishTimers = new Map();
        let scheduleDataEvent = ev => {
            let data;

            let fire = () => {
                clearTimeout(data.timeout);
                publishTimers.delete(ev);
                this._listeners.emit(ev);
            };

            if (publishTimers.has(ev)) {
                data = publishTimers.get(ev) || {};
                clearTimeout(data.timeout);
                data.count++;

                if (data.initial < Date.now() - 1000) {
                    // if the event has been held back already for a second, the fire immediatelly
                    return fire();
                }
            } else {
                // initialize new event object
                data = {
                    ev,
                    count: 1,
                    initial: Date.now(),
                    timeout: null
                };
            }

            data.timeout = setTimeout(fire, 100);
            data.timeout.unref();

            if (!publishTimers.has(ev)) {
                publishTimers.set(ev, data);
            }
        };

        this.subsriber.on('message', (channel, message) => {
            if (channel === 'wd_events') {
                try {
                    let data = JSON.parse(message);
                    if (data.e && !data.p) {
                        scheduleDataEvent(data.e);
                    } else {
                        this._listeners.emit(data.e, data.p);
                    }
                } catch (E) {
                    //
                }
            }
        });
        this.subsriber.subscribe('wd_events');
    }

    /**
     * Generates hashed event names for mailbox:username pairs
     *
     * @param {String} path
     * @param {String} username
     * @returns {String} md5 hex
     */
    _eventName(path, username) {
        return crypto.createHash('md5').update(username + ':' + path).digest('hex');
    }

    /**
     * Registers an event handler for path:username events
     *
     * @param {String} username
     * @param {String} path
     * @param {Function} handler Function to run once there are new entries in the journal
     */
    addListener(session, path, handler) {
        let eventName = this._eventName(session.user.username, path);
        this._listeners.addListener(eventName, handler);

        this.logger.debug('New journal listener for %s ("%s:%s")', eventName, session.user.username, path);
    }

    /**
     * Unregisters an event handler for path:username events
     *
     * @param {String} username
     * @param {String} path
     * @param {Function} handler Function to run once there are new entries in the journal
     */
    removeListener(session, path, handler) {
        let eventName = this._eventName(session.user.username, path);
        this._listeners.removeListener(eventName, handler);

        this.logger.debug('Removed journal listener from %s ("%s:%s")', eventName, session.user.username, path);
    }

    /**
     * Stores multiple journal entries to db
     *
     * @param {String} username
     * @param {String} path
     * @param {Array|Object} entries An array of entries to be journaled
     * @param {Function} callback Runs once the entry is either stored or an error occurred
     */
    addEntries(username, path, entries, callback) {
        if (entries && !Array.isArray(entries)) {
            entries = [entries];
        } else if (!entries || !entries.length) {
            return callback(null, false);
        }

        let modseqsNeeded = entries.length;
        entries.forEach(entry => {
            if (entry.modseq) {
                modseqsNeeded--;
            }
            entry.created = new Date();
        });

        let mailbox;
        if (username && typeof username === 'object' && username._id) {
            mailbox = username;
            username = false;
        }
        let mailboxQuery = mailbox ? {
            _id: mailbox._id
        } : {
            username,
            path
        };

        let getMailbox = next => {
            if (modseqsNeeded) {
                return this.database.collection('mailboxes').findOneAndUpdate(mailboxQuery, {
                    $inc: {
                        modifyIndex: modseqsNeeded
                    }
                }, {}, (err, item) => {
                    if (err) {
                        return callback(err);
                    }

                    next(null, item && item.value);
                });
            }
            if (mailbox) {
                return next(null, mailbox);
            }
            this.database.collection('mailboxes').findOne(mailboxQuery, next);
        };

        getMailbox((err, mailbox) => {
            if (err) {
                return callback(err);
            }
            if (!mailbox) {
                return callback(null, new Error('Selected mailbox does not exist'));
            }

            let startIndex = mailbox.modifyIndex;

            let updated = 0;
            let updateNext = () => {
                if (updated >= entries.length) {
                    return this.database.collection('journal').insertMany(entries, {
                        w: 1,
                        ordered: false
                    }, (err, r) => {
                        if (err) {
                            return callback(err);
                        }
                        return callback(null, r.insertedCount);
                    });
                }

                let entry = entries[updated++];
                let setModseq = !!entry.modseq;

                entry.mailbox = mailbox._id;
                if (!setModseq) {
                    entry.modseq = ++startIndex;
                }

                if (entry.message && setModseq) {
                    this.database.collection('messages').findOneAndUpdate({
                        _id: entry.message,
                        modseq: {
                            $lt: entry.modseq
                        }
                    }, {
                        $set: {
                            modseq: entry.modseq
                        }
                    }, {}, err => {
                        if (err) {
                            this.logger.error('Error updating modseq for message %s. %s', entry.message, err.message);
                        }
                        updateNext();
                    });
                } else {
                    updateNext();
                }
            };

            updateNext();
        });
    }

    /**
     * Sends a notification that there are new updates in the selected mailbox
     *
     * @param {String} username
     * @param {String} path
     */
    fire(username, path, payload) {
        let eventName = this._eventName(username, path);
        setImmediate(() => {
            let data = JSON.stringify({
                e: eventName,
                p: payload
            });
            this.publisher.publish('wd_events', data);
        });
    }

    /**
     * Returns all entries from the journal that have higher than provided modification index
     *
     * @param {String} session
     * @param {String} path
     * @param {Number} modifyIndex Last known modification id
     * @param {Function} callback Returns update entries as an array
     */
    getUpdates(session, path, modifyIndex, callback) {
        modifyIndex = Number(modifyIndex) || 0;
        let username = session.user.username;

        this.database.collection('mailboxes').findOne({
            username,
            path
        }, (err, mailbox) => {
            if (err) {
                return callback(err);
            }
            if (!mailbox) {
                return callback(null, 'NONEXISTENT');
            }
            this.database.collection('journal').find({
                mailbox: mailbox._id,
                modseq: {
                    $gt: modifyIndex
                }
            }).sort({
                modseq: 1
            }).toArray(callback);
        });
    }

}

module.exports = ImapNotifier;
