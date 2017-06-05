'use strict';

const config = require('config');
const redis = require('redis');
const uuidV1 = require('uuid/v1');
const ObjectID = require('mongodb').ObjectID;
const Indexer = require('../imap-core/lib/indexer/indexer');
const ImapNotifier = require('./imap-notifier');
const tools = require('./tools');
const libmime = require('libmime');
const counters = require('./counters');

// how many modifications to cache before writing
const BULK_BATCH_SIZE = 150;
const SCHEMA_VERSION = '1.0';
// how much plaintext to store. this is indexed with a fulltext index
const MAX_PLAINTEXT_CONTENT = 2 * 1024;
// how much HTML content to store. not indexed
const MAX_HTML_CONTENT = 300 * 1024;

// index only the following headers for SEARCH
const INDEXED_HEADERS = ['to', 'cc', 'subject', 'from', 'sender', 'reply-to', 'message-id', 'thread-index'];

class MessageHandler {
    constructor(database, redisConfig) {
        this.database = database;
        this.redis = redisConfig || tools.redisConfig(config.redis);
        this.indexer = new Indexer({
            database
        });
        this.notifier = new ImapNotifier({
            database,
            pushOnly: true
        });
        this.counters = counters(redis.createClient(this.redis));
    }

    getMailbox(options, callback) {
        let query = {};
        if (options.mailbox) {
            if (typeof options.mailbox === 'object' && options.mailbox._id) {
                return setImmediate(() => callback(null, options.mailbox));
            }
            query._id = options.mailbox;
        } else {
            query.user = options.user;
            if (options.specialUse) {
                query.specialUse = options.specialUse;
            } else {
                query.path = options.path;
            }
        }

        this.database.collection('mailboxes').findOne(query, (err, mailbox) => {
            if (err) {
                return callback(err);
            }

            if (!mailbox) {
                let err = new Error('Mailbox is missing');
                err.imapResponse = 'TRYCREATE';
                return callback(err);
            }

            callback(null, mailbox);
        });
    }

    // Monster method for inserting new messages to a mailbox
    // TODO: Refactor into smaller pieces
    add(options, callback) {
        let prepared = options.prepared || this.prepareMessage(options);

        let id = prepared.id;
        let mimeTree = prepared.mimeTree;
        let size = prepared.size;
        let bodystructure = prepared.bodystructure;
        let envelope = prepared.envelope;
        let idate = prepared.idate;
        let hdate = prepared.hdate;
        let msgid = prepared.msgid;
        let headers = prepared.headers;

        let flags = Array.isArray(options.flags) ? options.flags : [].concat(options.flags || []);
        let maildata = options.maildata || this.indexer.getMaildata(id, mimeTree);

        this.getMailbox(options, (err, mailbox) => {
            if (err) {
                return callback(err);
            }

            this.checkExistingMessage(
                mailbox._id,
                {
                    hdate,
                    msgid,
                    flags
                },
                options,
                (...args) => {
                    if (args[0] || args[1]) {
                        return callback(...args);
                    }

                    let cleanup = (...args) => {
                        if (!args[0]) {
                            return callback(...args);
                        }

                        let attachments = Object.keys(maildata.map || {}).map(key => maildata.map[key]);
                        if (!attachments.length) {
                            return callback(...args);
                        }

                        // error occured, remove attachments
                        this.database.collection('attachments.files').deleteMany({
                            _id: {
                                $in: attachments
                            }
                        }, () => callback(...args));
                    };

                    this.indexer.storeNodeBodies(id, maildata, mimeTree, err => {
                        if (err) {
                            return cleanup(err);
                        }

                        // prepare message object
                        let message = {
                            _id: id,

                            v: SCHEMA_VERSION,

                            // if true then expirest after rdate + retention
                            exp: !!mailbox.retention,
                            rdate: Date.now() + (mailbox.retention || 0),

                            idate,
                            hdate,
                            flags,
                            size,

                            // some custom metadata about the delivery
                            meta: options.meta || {},

                            // list filter IDs that matched this message
                            filters: Array.isArray(options.filters) ? options.filters : [].concat(options.filters || []),

                            headers,
                            mimeTree,
                            envelope,
                            bodystructure,
                            msgid,

                            // use boolean for more commonly used (and searched for) flags
                            seen: flags.includes('\\Seen'),
                            flagged: flags.includes('\\Flagged'),
                            deleted: flags.includes('\\Deleted'),
                            draft: flags.includes('\\Draft'),

                            magic: maildata.magic,
                            map: maildata.map
                        };

                        if (maildata.attachments && maildata.attachments.length) {
                            message.attachments = maildata.attachments;
                            message.ha = true;
                        } else {
                            message.ha = false;
                        }

                        if (maildata.text) {
                            message.text = maildata.text.replace(/\r\n/g, '\n').trim();
                            // text is indexed with a fulltext index, so only store the beginning of it
                            message.text = message.text.length <= MAX_PLAINTEXT_CONTENT ? message.text : message.text.substr(0, MAX_PLAINTEXT_CONTENT);
                            message.intro = message.text.replace(/\s+/g, ' ').trim();
                            if (message.intro.length > 128) {
                                let intro = message.intro.substr(0, 128);
                                let lastSp = intro.lastIndexOf(' ');
                                if (lastSp > 0) {
                                    intro = intro.substr(0, lastSp);
                                }
                                message.intro = intro + '…';
                            }
                        }

                        if (maildata.html && maildata.html.length) {
                            let htmlSize = 0;
                            message.html = maildata.html
                                .map(html => {
                                    if (htmlSize >= MAX_HTML_CONTENT || !html) {
                                        return '';
                                    }

                                    if (htmlSize + Buffer.byteLength(html) <= MAX_HTML_CONTENT) {
                                        htmlSize += Buffer.byteLength(html);
                                        return html;
                                    }

                                    html = html.substr(0, htmlSize + Buffer.byteLength(html) - MAX_HTML_CONTENT);
                                    htmlSize += Buffer.byteLength(html);
                                    return html;
                                })
                                .filter(html => html);
                        }

                        this.database.collection('users').findOneAndUpdate({
                            _id: mailbox.user
                        }, {
                            $inc: {
                                storageUsed: size
                            }
                        }, err => {
                            if (err) {
                                return cleanup(err);
                            }

                            let rollback = err => {
                                this.database.collection('users').findOneAndUpdate({
                                    _id: mailbox.user
                                }, {
                                    $inc: {
                                        storageUsed: -size
                                    }
                                }, () => {
                                    cleanup(err);
                                });
                            };

                            // acquire new UID+MODSEQ
                            this.database.collection('mailboxes').findOneAndUpdate({
                                _id: mailbox._id
                            }, {
                                $inc: {
                                    // allocate bot UID and MODSEQ values so when journal is later sorted by
                                    // modseq then UIDs are always in ascending order
                                    uidNext: 1,
                                    modifyIndex: 1
                                }
                            }, (err, item) => {
                                if (err) {
                                    return rollback(err);
                                }

                                if (!item || !item.value) {
                                    // was not able to acquire a lock
                                    let err = new Error('Mailbox is missing');
                                    err.imapResponse = 'TRYCREATE';
                                    return rollback(err);
                                }

                                let mailbox = item.value;

                                // updated message object by setting mailbox specific values
                                message.mailbox = mailbox._id;
                                message.user = mailbox.user;
                                message.uid = mailbox.uidNext;
                                message.modseq = mailbox.modifyIndex + 1;

                                this.database.collection('messages').insertOne(message, err => {
                                    if (err) {
                                        return rollback(err);
                                    }

                                    let uidValidity = mailbox.uidValidity;
                                    let uid = message.uid;

                                    if (options.session && options.session.selected && options.session.selected.mailbox === mailbox.path) {
                                        options.session.writeStream.write(options.session.formatResponse('EXISTS', message.uid));
                                    }

                                    this.notifier.addEntries(
                                        mailbox,
                                        false,
                                        {
                                            command: 'EXISTS',
                                            uid: message.uid,
                                            ignore: options.session && options.session.id,
                                            message: message._id,
                                            modseq: message.modseq
                                        },
                                        () => {
                                            this.notifier.fire(mailbox.user, mailbox.path);
                                            return cleanup(null, true, {
                                                uidValidity,
                                                uid,
                                                id: message._id
                                            });
                                        }
                                    );
                                });
                            });
                        });
                    });
                }
            );
        });
    }

    checkExistingMessage(mailboxId, message, options, callback) {
        // if a similar message already exists then update existing one
        this.database.collection('messages').findOne({
            mailbox: mailboxId,
            hdate: message.hdate,
            msgid: message.msgid
        }, (err, existing) => {
            if (err) {
                return callback(err);
            }

            if (!existing) {
                // nothing to do here, continue adding message
                return callback();
            }

            if (options.skipExisting) {
                // message already exists, just skip it
                return callback(null, false, {
                    id: existing._id
                });
            }

            // As duplicate message was found, update UID, MODSEQ and FLAGS

            // acquire new UID+MODSEQ
            this.database.collection('mailboxes').findOneAndUpdate({
                _id: mailboxId
            }, {
                $inc: {
                    // allocate bot UID and MODSEQ values so when journal is later sorted by
                    // modseq then UIDs are always in ascending order
                    uidNext: 1,
                    modifyIndex: 1
                }
            }, {
                returnOriginal: true
            }, (err, item) => {
                if (err) {
                    return callback(err);
                }

                if (!item || !item.value) {
                    // was not able to acquire a lock
                    let err = new Error('Mailbox is missing');
                    err.imapResponse = 'TRYCREATE';
                    return callback(err);
                }

                let mailbox = item.value;
                let uid = mailbox.uidNext;
                let modseq = mailbox.modifyIndex + 1;

                this.database.collection('messages').findOneAndUpdate({
                    _id: existing._id
                }, {
                    $set: {
                        uid,
                        modseq,
                        flags: message.flags
                    }
                }, {
                    returnOriginal: false
                }, (err, item) => {
                    if (err) {
                        return callback(err);
                    }

                    if (!item || !item.value) {
                        // message was not found for whatever reason
                        return callback();
                    }

                    let updated = item.value;

                    if (options.session && options.session.selected && options.session.selected.mailbox === mailbox.path) {
                        options.session.writeStream.write(options.session.formatResponse('EXPUNGE', existing.uid));
                    }

                    if (options.session && options.session.selected && options.session.selected.mailbox === mailbox.path) {
                        options.session.writeStream.write(options.session.formatResponse('EXISTS', updated.uid));
                    }
                    this.notifier.addEntries(
                        mailbox,
                        false,
                        {
                            command: 'EXPUNGE',
                            ignore: options.session && options.session.id,
                            uid: existing.uid,
                            message: existing._id
                        },
                        () => {
                            this.notifier.addEntries(
                                mailbox,
                                false,
                                {
                                    command: 'EXISTS',
                                    uid: updated.uid,
                                    ignore: options.session && options.session.id,
                                    message: updated._id,
                                    modseq: updated.modseq
                                },
                                () => {
                                    this.notifier.fire(mailbox.user, mailbox.path);
                                    return callback(null, true, {
                                        uidValidity: mailbox.uidValidity,
                                        uid,
                                        id: existing._id
                                    });
                                }
                            );
                        }
                    );
                });
            });
        });
    }

    updateQuota(mailbox, inc, callback) {
        inc = inc || {};

        this.database.collection('users').findOneAndUpdate(
            {
                _id: mailbox.user
            },
            {
                $inc: {
                    storageUsed: Number(inc.storageUsed) || 0
                }
            },
            callback
        );
    }

    del(options, callback) {
        let getMessage = next => {
            if (options.message) {
                return next(null, options.message);
            }
            this.database.collection('messages').findOne(
                options.query,
                {
                    fields: {
                        mailbox: true,
                        uid: true,
                        size: true,
                        map: true,
                        magic: true
                    }
                },
                next
            );
        };

        getMessage((err, message) => {
            if (err) {
                return callback(err);
            }

            if (!message) {
                return callback(new Error('Message does not exist'));
            }

            this.getMailbox(
                {
                    mailbox: options.mailbox || message.mailbox
                },
                (err, mailbox) => {
                    if (err) {
                        return callback(err);
                    }

                    this.database.collection('messages').deleteOne({
                        _id: message._id
                    }, err => {
                        if (err) {
                            return callback(err);
                        }

                        this.updateQuota(
                            mailbox,
                            {
                                storageUsed: -message.size
                            },
                            () => {
                                let updateAttachments = next => {
                                    let attachments = Object.keys(message.map || {}).map(key => message.map[key]);
                                    if (!attachments.length) {
                                        return next();
                                    }

                                    // remove link to message from attachments (if any exist)
                                    this.database.collection('attachments.files').updateMany({
                                        _id: {
                                            $in: attachments
                                        }
                                    }, {
                                        $inc: {
                                            'metadata.c': -1,
                                            'metadata.m': -message.magic
                                        }
                                    }, {
                                        multi: true,
                                        w: 1
                                    }, err => {
                                        if (err) {
                                            // ignore as we don't really care if we have orphans or not
                                        }
                                        next();
                                    });
                                };

                                updateAttachments(() => {
                                    if (options.session && options.session.selected && options.session.selected.mailbox === mailbox.path) {
                                        options.session.writeStream.write(options.session.formatResponse('EXPUNGE', message.uid));
                                    }

                                    this.notifier.addEntries(
                                        mailbox,
                                        false,
                                        {
                                            command: 'EXPUNGE',
                                            ignore: options.session && options.session.id,
                                            uid: message.uid,
                                            message: message._id
                                        },
                                        () => {
                                            this.notifier.fire(mailbox.user, mailbox.path);

                                            if (options.skipAttachments) {
                                                return callback(null, true);
                                            }

                                            return callback(null, true);
                                        }
                                    );
                                });
                            }
                        );
                    });
                }
            );
        });
    }

    move(options, callback) {
        this.getMailbox(options.source, (err, mailbox) => {
            if (err) {
                return callback(err);
            }

            this.getMailbox(options.destination, (err, target) => {
                if (err) {
                    return callback(err);
                }

                this.database.collection('mailboxes').findOneAndUpdate({
                    _id: mailbox._id
                }, {
                    $inc: {
                        // increase the mailbox modification index
                        // to indicate that something happened
                        modifyIndex: 1
                    }
                }, {
                    uidNext: true
                }, () => {
                    let cursor = this.database
                        .collection('messages')
                        .find({
                            mailbox: mailbox._id,
                            uid: {
                                $in: options.messages || []
                            }
                        })
                        .project({
                            uid: 1
                        })
                        .sort([['uid', 1]]);

                    let sourceUid = [];
                    let destinationUid = [];

                    let removeEntries = [];
                    let existsEntries = [];

                    let done = err => {
                        let next = () => {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, true, {
                                uidValidity: target.uidValidity,
                                sourceUid,
                                destinationUid
                            });
                        };

                        if (existsEntries.length) {
                            // mark messages as deleted from old mailbox
                            return this.notifier.addEntries(mailbox, false, removeEntries, () => {
                                // mark messages as added to new mailbox
                                this.notifier.addEntries(target, false, existsEntries, () => {
                                    this.notifier.fire(mailbox.user, mailbox.path);
                                    this.notifier.fire(target.user, target.path);
                                    next();
                                });
                            });
                        }
                        next();
                    };

                    let processNext = () => {
                        cursor.next((err, message) => {
                            if (err) {
                                return done(err);
                            }
                            if (!message) {
                                return cursor.close(done);
                            }

                            sourceUid.unshift(message.uid);
                            this.database.collection('mailboxes').findOneAndUpdate({
                                _id: target._id
                            }, {
                                $inc: {
                                    uidNext: 1
                                }
                            }, {
                                uidNext: true
                            }, (err, item) => {
                                if (err) {
                                    return cursor.close(() => done(err));
                                }

                                if (!item || !item.value) {
                                    return cursor.close(() => done(new Error('Mailbox disappeared')));
                                }

                                let uidNext = item.value.uidNext;
                                destinationUid.unshift(uidNext);

                                let updateOptions = {
                                    $set: {
                                        mailbox: target._id,
                                        // new mailbox means new UID
                                        uid: uidNext,
                                        // this will be changed later by the notification system
                                        modseq: 0,

                                        // retention settings
                                        exp: !!target.retention,
                                        rdate: Date.now() + (target.retention || 0)
                                    }
                                };

                                if (options.markAsSeen) {
                                    updateOptions.$set.seen = true;
                                    updateOptions.$addToSet = {
                                        flags: '\\Seen'
                                    };
                                }

                                // update message, change mailbox from old to new one
                                this.database.collection('messages').findOneAndUpdate({
                                    _id: message._id
                                }, updateOptions, err => {
                                    if (err) {
                                        return cursor.close(() => done(err));
                                    }

                                    if (options.session) {
                                        options.session.writeStream.write(options.session.formatResponse('EXPUNGE', message.uid));
                                    }

                                    removeEntries.push({
                                        command: 'EXPUNGE',
                                        ignore: options.session && options.session.id,
                                        uid: message.uid
                                    });

                                    existsEntries.push({
                                        command: 'EXISTS',
                                        uid: uidNext,
                                        message: message._id
                                    });

                                    if (existsEntries.length >= BULK_BATCH_SIZE) {
                                        // mark messages as deleted from old mailbox
                                        return this.notifier.addEntries(mailbox, false, removeEntries, () => {
                                            // mark messages as added to new mailbox
                                            this.notifier.addEntries(target, false, existsEntries, () => {
                                                removeEntries = [];
                                                existsEntries = [];
                                                this.notifier.fire(mailbox.user, mailbox.path);
                                                this.notifier.fire(target.user, target.path);
                                                processNext();
                                            });
                                        });
                                    }
                                    processNext();
                                });
                            });
                        });
                    };

                    processNext();
                });
            });
        });
    }

    generateIndexedHeaders(headersArray) {
        return (headersArray || [])
            .map(line => {
                line = Buffer.from(line, 'binary').toString();

                let key = line.substr(0, line.indexOf(':')).trim().toLowerCase();

                if (!INDEXED_HEADERS.includes(key)) {
                    // do not index this header
                    return false;
                }

                let value = line.substr(line.indexOf(':') + 1).trim().replace(/\s*\r?\n\s*/g, ' ');

                try {
                    value = libmime.decodeWords(value);
                } catch (E) {
                    // ignore
                }

                // store indexed value as lowercase for easier SEARCHing
                value = value.toLowerCase();

                // trim long values as mongodb indexed fields can not be too long
                if (Buffer.byteLength(key, 'utf-8') >= 255) {
                    key = Buffer.from(key).slice(0, 255).toString();
                    key = key.substr(0, key.length - 4);
                }

                if (Buffer.byteLength(value, 'utf-8') >= 880) {
                    // value exceeds MongoDB max indexed value length
                    value = Buffer.from(value).slice(0, 880).toString();
                    // remove last 4 chars to be sure we do not have any incomplete unicode sequences
                    value = value.substr(0, value.length - 4);
                }

                return {
                    key,
                    value
                };
            })
            .filter(line => line);
    }

    prepareMessage(options) {
        let id = new ObjectID();

        let mimeTree = this.indexer.parseMimeTree(options.raw);

        let size = this.indexer.getSize(mimeTree);
        let bodystructure = this.indexer.getBodyStructure(mimeTree);
        let envelope = this.indexer.getEnvelope(mimeTree);

        let idate = (options.date && new Date(options.date)) || new Date();
        let hdate = (mimeTree.parsedHeader.date && new Date(mimeTree.parsedHeader.date)) || false;

        let flags = [].concat(options.flags || []);

        if (!hdate || hdate.toString() === 'Invalid Date') {
            hdate = idate;
        }

        let msgid = envelope[9] || '<' + uuidV1() + '@wildduck.email>';

        let headers = this.generateIndexedHeaders(mimeTree.header);

        return {
            id,
            mimeTree,
            size,
            bodystructure,
            envelope,
            idate,
            hdate,
            flags,
            msgid,
            headers
        };
    }
}

module.exports = MessageHandler;
