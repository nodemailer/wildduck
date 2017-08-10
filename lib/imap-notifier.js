'use strict';

const config = require('wild-config');
const tools = require('./tools');
const consts = require('./consts');
const crypto = require('crypto');
const EventEmitter = require('events').EventEmitter;
const redis = require('redis');
const log = require('npmlog');
const counters = require('./counters');

class ImapNotifier extends EventEmitter {
    constructor(options) {
        super();

        this.database = options.database;
        this.publisher = options.redis || redis.createClient(tools.redisConfig(config.dbs.redis));
        this.cachedcounter = counters(this.publisher).cachedcounter;

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
        this.subsriber = redis.createClient(tools.redisConfig(config.dbs.redis));
        this._listeners = new EventEmitter();
        this._listeners.setMaxListeners(0);

        let publishTimers = new Map();
        let scheduleDataEvent = ev => {
            let data;

            let fire = () => {
                clearTimeout(data.timeout);
                publishTimers.delete(ev);
                this._listeners.emit(ev);
                this._listeners.emit(ev.split(':').shift() + ':*');
            };

            if (publishTimers.has(ev)) {
                data = publishTimers.get(ev) || {};
                clearTimeout(data.timeout);
                data.count++;

                if (data.initial < Date.now() - 1000) {
                    // if the event has been held back already for a second, then fire immediatelly
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
                    } else if (data.e) {
                        this._listeners.emit(data.e, data.p);
                        this._listeners.emit(data.e.split(':').shift() + ':*', data.p);
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
    _eventName(user, path) {
        if (path.length >= 32) {
            path = crypto.createHash('md5').update(path).digest('hex');
        }
        return user + ':' + path;
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

                setImmediate(() => this.updateCounters(entries));

                return callback(null, r.insertedCount);
            });
        };

        getMailbox((err, mailboxData) => {
            if (err) {
                return callback(err);
            }
            if (!mailboxData) {
                return callback(null, new Error('Selected mailbox does not exist'));
            }

            let modseq = mailboxData.modifyIndex;
            let created = new Date();
            entries.forEach(entry => {
                entry.modseq = entry.modseq || modseq;
                entry.created = entry.created || created;
                entry.mailbox = entry.mailbox || mailboxData._id;
                entry.user = mailboxData.user;
            });

            if (updated.length) {
                this.logger.debug('Updating message collection %s %s entries', mailboxData._id, updated.length);
                this.database.collection('messages').updateMany({
                    _id: {
                        $in: updated
                    },
                    mailbox: mailboxData._id
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

    updateCounters(entries) {
        if (!entries) {
            return;
        }
        let counters = new Map();
        (Array.isArray(entries) ? entries : [].concat(entries || [])).forEach(entry => {
            let m = entry.mailbox.toString();
            if (!counters.has(m)) {
                counters.set(m, { total: 0, unseen: 0, unseenChange: false });
            }
            switch (entry && entry.command) {
                case 'EXISTS':
                    counters.get(m).total += 1;
                    if (entry.unseen) {
                        counters.get(m).unseen += 1;
                    }
                    break;
                case 'EXPUNGE':
                    counters.get(m).total -= 1;
                    if (entry.unseen) {
                        counters.get(m).unseen -= 1;
                    }
                    break;
                case 'FETCH':
                    if (entry.unseen) {
                        // either increase or decrese
                        counters.get(m).unseen += typeof entry.unseen === 'number' ? entry.unseen : 1;
                    } else if (entry.unseenChange) {
                        // volatile change, just clear the cache
                        counters.get(m).unseenChange = true;
                    }
                    break;
            }
        });

        let pos = 0;
        let rows = Array.from(counters);
        let updateCounter = () => {
            if (pos >= rows.length) {
                return;
            }
            let row = rows[pos++];
            if (!row || !row.length) {
                return updateCounter();
            }
            let mailbox = row[0];
            let delta = row[1];

            this.cachedcounter('total:' + mailbox, delta.total, consts.MAILBOX_COUNTER_TTL, () => {
                if (delta.unseenChange) {
                    // Message info changed in mailbox, so just te be sure, clear the unseen counter as well
                    // Unseen counter is more volatile and also easier to count (usually only a small number on indexed messages)
                    this.publisher.del('unseen:' + mailbox, updateCounter);
                } else if (delta.unseen) {
                    this.cachedcounter('unseen:' + mailbox, delta.unseen, consts.MAILBOX_COUNTER_TTL, updateCounter);
                } else {
                    setImmediate(updateCounter);
                }
            });
        };

        updateCounter();
    }
}

module.exports = ImapNotifier;
