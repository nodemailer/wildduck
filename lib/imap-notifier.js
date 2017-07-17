'use strict';

const config = require('wild-config');
const tools = require('./tools');
const crypto = require('crypto');
const EventEmitter = require('events').EventEmitter;
const redis = require('redis');
const log = require('npmlog');

class ImapNotifier extends EventEmitter {
    constructor(options) {
        super();

        this.database = options.database;
        this.publisher = options.redis || redis.createClient(tools.redisConfig(config.redis));

        this.logger = options.logger || {
            info: log.silly.bind(log, 'IMAP'),
            debug: log.silly.bind(log, 'IMAP'),
            error: log.error.bind(log, 'IMAP')
        };

        if (options.pushOnly) {
            // do not need to set up the following if we do not care about updates
            return;
        }

        // Subscriber needs its own client connection. This is relevant only in the context of IMAP
        this.subsriber = redis.createClient(tools.redisConfig(config.redis));
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
     * Generates hashed event names for mailbox:user pairs
     *
     * @param {String} path
     * @param {String} user
     * @returns {String} md5 hex
     */
    _eventName(path, user) {
        return crypto.createHash('md5').update(user.toString() + ':' + path).digest('hex');
    }

    /**
     * Registers an event handler for path:userid events
     *
     * @param {String} user
     * @param {String} path
     * @param {Function} handler Function to run once there are new entries in the journal
     */
    addListener(session, path, handler) {
        let eventName = this._eventName(session.user.id.toString(), path);
        this._listeners.addListener(eventName, handler);

        this.logger.debug('[%s] New journal listener for %s ("%s:%s")', session.id, eventName, session.user.username, path);
    }

    /**
     * Unregisters an event handler for path:user events
     *
     * @param {String} user
     * @param {String} path
     * @param {Function} handler Function to run once there are new entries in the journal
     */
    removeListener(session, path, handler) {
        let eventName = this._eventName(session.user.id.toString(), path);
        this._listeners.removeListener(eventName, handler);

        this.logger.debug('[%s] Removed journal listener from %s ("%s:%s")', session.id, eventName, session.user.username, path);
    }

    /**
     * Stores multiple journal entries to db
     *
     * @param {String} user
     * @param {String} path
     * @param {Array|Object} entries An array of entries to be journaled
     * @param {Function} callback Runs once the entry is either stored or an error occurred
     */
    addEntries(user, path, entries, callback) {
        if (entries && !Array.isArray(entries)) {
            entries = [entries];
        } else if (!entries || !entries.length) {
            return callback(null, false);
        }

        // find list of message ids that need to be updated
        let updated = entries.filter(entry => !entry.modseq && entry.message).map(entry => entry.message);

        let getMailbox = next => {
            let mailbox;

            if (user && typeof user === 'object' && user._id) {
                mailbox = user;
                user = false;
            }

            let mailboxQuery = mailbox
                ? {
                    _id: mailbox._id
                }
                : {
                    user,
                    path
                };

            if (updated.length) {
                // provision new modseq value
                return this.database.collection('mailboxes').findOneAndUpdate(mailboxQuery, {
                    $inc: {
                        modifyIndex: 1
                    }
                }, {
                    returnOriginal: false
                }, (err, item) => {
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

        // final action to push entries to journal
        let pushToJournal = () => {
            this.database.collection('journal').insertMany(entries, {
                w: 1,
                ordered: false
            }, (err, r) => {
                if (err) {
                    return callback(err);
                }
                return callback(null, r.insertedCount);
            });
        };

        getMailbox((err, mailbox) => {
            if (err) {
                return callback(err);
            }
            if (!mailbox) {
                return callback(null, new Error('Selected mailbox does not exist'));
            }

            let modseq = mailbox.modifyIndex;
            let created = new Date();
            entries.forEach(entry => {
                entry.modseq = entry.modseq || modseq;
                entry.created = entry.created || created;
                entry.mailbox = entry.mailbox || mailbox._id;
            });

            if (updated.length) {
                this.database.collection('messages').updateMany({
                    _id: {
                        $in: updated
                    },
                    mailbox: mailbox._id
                }, {
                    // only update modseq if the new value is larger than old one
                    $max: {
                        modseq
                    }
                }, err => {
                    if (err) {
                        this.logger.error('Error updating modseq for messages. %s', err.message);
                    }
                    pushToJournal();
                });
            } else {
                pushToJournal();
            }
        });
    }

    /**
     * Sends a notification that there are new updates in the selected mailbox
     *
     * @param {String} user
     * @param {String} path
     */
    fire(user, path, payload) {
        let eventName = this._eventName(user, path);
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
        let user = session.user.id;

        this.database.collection('mailboxes').findOne({
            user,
            path
        }, (err, mailbox) => {
            if (err) {
                return callback(err);
            }
            if (!mailbox) {
                return callback(null, 'NONEXISTENT');
            }
            this.database
                .collection('journal')
                .find({
                    mailbox: mailbox._id,
                    modseq: {
                        $gt: modifyIndex
                    }
                })
                .sort([['modseq', 1]])
                .toArray(callback);
        });
    }
}

module.exports = ImapNotifier;
