'use strict';

const log = require('npmlog');
const config = require('config');
const IMAPServerModule = require('./imap-core');
const IMAPServer = IMAPServerModule.IMAPServer;
const ImapNotifier = require('./lib/imap-notifier');
const imapHandler = IMAPServerModule.imapHandler;
const bcrypt = require('bcryptjs');
const ObjectID = require('mongodb').ObjectID;
const Indexer = require('./imap-core/lib/indexer/indexer');
const imapTools = require('./imap-core/lib/imap-tools');
const fs = require('fs');
const setupIndexes = require('./indexes.json');
const MessageHandler = require('./lib/message-handler');
const db = require('./lib/db');
const packageData = require('./package.json');

// Setup server
const serverOptions = {
    secure: config.imap.secure,
    ignoreSTARTTLS: config.imap.ignoreSTARTTLS,

    id: {
        name: 'Wild Duck IMAP Server',
        version: packageData.version,
        vendor: 'Kreata'
    },

    logger: {
        info: log.silly.bind(log, 'IMAP'),
        debug: log.silly.bind(log, 'IMAP'),
        error: log.error.bind(log, 'IMAP')
    },

    maxMessage: config.imap.maxMB * 1024 * 1024,
    maxStorage: config.imap.maxStorage * 1024 * 1024
};

if (config.imap.key) {
    serverOptions.key = fs.readFileSync(config.imap.key);
}

if (config.imap.cert) {
    serverOptions.cert = fs.readFileSync(config.imap.cert);
}

const server = new IMAPServer(serverOptions);

let messageHandler;

server.onAuth = function (login, session, callback) {
    let username = (login.username || '').toString().trim();

    db.database.collection('users').findOne({
        username
    }, (err, user) => {
        if (err) {
            return callback(err);
        }
        if (!user) {
            return callback();
        }

        if (!bcrypt.compareSync(login.password, user.password)) {
            return callback();
        }

        callback(null, {
            user: {
                id: user._id,
                username
            }
        });
    });

};

// LIST "" "*"
// Returns all folders, query is informational
// folders is either an Array or a Map
server.onList = function (query, session, callback) {
    this.logger.debug('[%s] LIST for "%s"', session.id, query);
    db.database.collection('mailboxes').find({
        user: session.user.id
    }).toArray(callback);
};

// LSUB "" "*"
// Returns all subscribed folders, query is informational
// folders is either an Array or a Map
server.onLsub = function (query, session, callback) {
    this.logger.debug('[%s] LSUB for "%s"', session.id, query);
    db.database.collection('mailboxes').find({
        user: session.user.id,
        subscribed: true
    }).toArray(callback);
};

// SUBSCRIBE "path/to/mailbox"
server.onSubscribe = function (path, session, callback) {
    this.logger.debug('[%s] SUBSCRIBE to "%s"', session.id, path);
    db.database.collection('mailboxes').findOneAndUpdate({
        user: session.user.id,
        path
    }, {
        $set: {
            subscribed: true
        }
    }, {}, (err, item) => {
        if (err) {
            return callback(err);
        }

        if (!item || !item.value) {
            // was not able to acquire a lock
            return callback(null, 'NONEXISTENT');
        }

        callback(null, true);
    });
};

// UNSUBSCRIBE "path/to/mailbox"
server.onUnsubscribe = function (path, session, callback) {
    this.logger.debug('[%s] UNSUBSCRIBE from "%s"', session.id, path);
    db.database.collection('mailboxes').findOneAndUpdate({
        user: session.user.id,
        path
    }, {
        $set: {
            subscribed: false
        }
    }, {}, (err, item) => {
        if (err) {
            return callback(err);
        }

        if (!item || !item.value) {
            // was not able to acquire a lock
            return callback(null, 'NONEXISTENT');
        }

        callback(null, true);
    });
};

// CREATE "path/to/mailbox"
server.onCreate = function (path, session, callback) {
    this.logger.debug('[%s] CREATE "%s"', session.id, path);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (mailbox) {
            return callback(null, 'ALREADYEXISTS');
        }

        mailbox = {
            user: session.user.id,
            path,
            uidValidity: Math.floor(Date.now() / 1000),
            uidNext: 1,
            modifyIndex: 0,
            subscribed: true,
            flags: []
        };

        db.database.collection('mailboxes').insertOne(mailbox, err => {
            if (err) {
                return callback(err);
            }
            return callback(null, true);
        });
    });
};

// RENAME "path/to/mailbox" "new/path"
// NB! RENAME affects child and hierarchy mailboxes as well, this example does not do this
server.onRename = function (path, newname, session, callback) {
    this.logger.debug('[%s] RENAME "%s" to "%s"', session.id, path, newname);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path: newname
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (mailbox) {
            return callback(null, 'ALREADYEXISTS');
        }

        db.database.collection('mailboxes').findOneAndUpdate({
            user: session.user.id,
            path
        }, {
            $set: {
                path: newname
            }
        }, {}, (err, item) => {
            if (err) {
                return callback(err);
            }

            if (!item || !item.value) {
                // was not able to acquire a lock
                return callback(null, 'NONEXISTENT');
            }

            callback(null, true);
        });
    });
};

// DELETE "path/to/mailbox"
server.onDelete = function (path, session, callback) {
    this.logger.debug('[%s] DELETE "%s"', session.id, path);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }
        if (mailbox.specialUse) {
            return callback(null, 'CANNOT');
        }

        db.database.collection('mailboxes').deleteOne({
            _id: mailbox._id
        }, err => {
            if (err) {
                return callback(err);
            }

            // calculate mailbox size by aggregating the size's of all messages
            db.database.collection('messages').aggregate([{
                $match: {
                    mailbox: mailbox._id
                }
            }, {
                $group: {
                    _id: {
                        mailbox: '$mailbox'
                    },
                    storageUsed: {
                        $sum: '$size'
                    }
                }
            }], {
                cursor: {
                    batchSize: 1
                }
            }).toArray((err, res) => {
                if (err) {
                    return callback(err);
                }

                let storageUsed = res && res[0] && res[0].storageUsed || 0;

                db.database.collection('messages').deleteMany({
                    mailbox: mailbox._id
                }, err => {
                    if (err) {
                        return callback(err);
                    }

                    let done = () => {
                        db.database.collection('journal').deleteMany({
                            mailbox: mailbox._id
                        }, err => {
                            if (err) {
                                return callback(err);
                            }
                            callback(null, true);
                        });
                    };

                    if (!storageUsed) {
                        return done();
                    }

                    // decrement quota counters
                    db.database.collection('users').findOneAndUpdate({
                        _id: mailbox.user
                    }, {
                        $inc: {
                            storageUsed: -Number(storageUsed) || 0
                        }
                    }, done);
                });
            });
        });
    });
};

// SELECT/EXAMINE
server.onOpen = function (path, session, callback) {
    this.logger.debug('[%s] Opening "%s"', session.id, path);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        db.database.collection('messages').find({
            mailbox: mailbox._id
        }).project({
            uid: true
        }).sort([
            ['uid', 1]
        ]).toArray((err, messages) => {
            if (err) {
                return callback(err);
            }
            mailbox.uidList = messages.map(message => message.uid);
            callback(null, mailbox);
        });
    });
};

// STATUS (X Y X)
server.onStatus = function (path, session, callback) {
    this.logger.debug('[%s] Requested status for "%s"', session.id, path);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        db.database.collection('messages').find({
            mailbox: mailbox._id
        }).count((err, total) => {
            if (err) {
                return callback(err);
            }
            db.database.collection('messages').find({
                mailbox: mailbox._id,
                flags: {
                    $ne: '\\Seen'
                }
            }).count((err, unseen) => {
                if (err) {
                    return callback(err);
                }

                return callback(null, {
                    messages: total,
                    uidNext: mailbox.uidNext,
                    uidValidity: mailbox.uidValidity,
                    unseen
                });
            });
        });

    });
};

// APPEND mailbox (flags) date message
server.onAppend = function (path, flags, date, raw, session, callback) {
    this.logger.debug('[%s] Appending message to "%s"', session.id, path);

    db.database.collection('users').findOne({
        _id: session.user.id
    }, (err, user) => {
        if (err) {
            return callback(err);
        }
        if (!user) {
            return callback(new Error('User not found'));
        }

        if (user.quota && user.storageUsed + raw.length > user.quota) {
            return callback(false, 'OVERQUOTA');
        }

        messageHandler.add({
            user: session.user.id,
            path,
            meta: {
                source: 'IMAP',
                to: session.user.username,
                time: Date.now()
            },
            date,
            flags,
            raw
        }, (err, status, data) => {
            if (err) {
                if (err.imapResponse) {
                    return callback(null, err.imapResponse);
                }
                return callback(err);
            }
            callback(null, status, data);
        });
    });
};

server.updateMailboxFlags = function (mailbox, update, callback) {
    if (update.action === 'remove') {
        // we didn't add any new flags, so there's nothing to update
        return callback();
    }

    let mailboxFlags = imapTools.systemFlags.concat(mailbox.flags || []).map(flag => flag.trim().toLowerCase());
    let newFlags = [];

    // find flags that are not listed with mailbox
    update.value.forEach(flag => {
        // limit mailbox flags by 100
        if (mailboxFlags.length + newFlags.length >= 100) {
            return;
        }
        // if mailbox does not have such flag, then add it
        if (!mailboxFlags.includes(flag.toLowerCase().trim())) {
            newFlags.push(flag);
        }
    });

    // nothing new found
    if (!newFlags.length) {
        return callback();
    }

    // found some new flags not yet set for mailbox
    // FIXME: Should we send unsolicited FLAGS and PERMANENTFLAGS notifications?
    return db.database.collection('mailboxes').findOneAndUpdate({
        _id: mailbox._id
    }, {
        $addToSet: {
            flags: {
                $each: newFlags
            }
        }
    }, {}, callback);
};

// STORE / UID STORE, updates flags for selected UIDs
server.onStore = function (path, update, session, callback) {
    this.logger.debug('[%s] Updating messages in "%s"', session.id, path);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        let cursor = db.database.collection('messages').find({
            mailbox: mailbox._id,
            uid: {
                $in: update.messages
            }
        }).project({
            _id: true,
            uid: true,
            flags: true
        }).sort([
            ['uid', 1]
        ]);

        let notifyEntries = [];
        let done = (...args) => {
            if (notifyEntries.length) {
                let entries = notifyEntries;
                notifyEntries = [];
                setImmediate(() => this.notifier.addEntries(session.user.id, path, entries, () => {
                    this.notifier.fire(session.user.id, path);
                    if (args[0]) { // first argument is an error
                        return callback(...args);
                    } else {
                        server.updateMailboxFlags(mailbox, update, () => callback(...args));
                    }
                }));
                return;
            }
            this.notifier.fire(session.user.id, path);
            if (args[0]) { // first argument is an error
                return callback(...args);
            } else {
                server.updateMailboxFlags(mailbox, update, () => callback(...args));
            }
        };

        // We have to process all messages one by one instead of just calling an update
        // for all messages as we need to know which messages were exactly modified,
        // otherwise we can't send flag update notifications and modify modseq values
        let processNext = () => {
            cursor.next((err, message) => {
                if (err) {
                    return done(err);
                }
                if (!message) {
                    return cursor.close(() => done(null, true));
                }

                let flagsupdate = false; // query object for updates

                let updated = false;
                let existingFlags = message.flags.map(flag => flag.toLowerCase().trim());
                switch (update.action) {
                    case 'set':
                        // check if update set matches current or is different
                        if (
                            // if length does not match
                            existingFlags.length !== update.value.length ||
                            // or a new flag was found
                            update.value.filter(flag => !existingFlags.includes(flag.toLowerCase().trim())).length
                        ) {
                            updated = true;
                        }

                        message.flags = [].concat(update.value);

                        // set flags
                        if (updated) {
                            flagsupdate = {
                                $set: {
                                    flags: message.flags
                                }
                            };
                        }
                        break;

                    case 'add':
                        {
                            let newFlags = [];
                            message.flags = message.flags.concat(update.value.filter(flag => {
                                if (!existingFlags.includes(flag.toLowerCase().trim())) {
                                    updated = true;
                                    newFlags.push(flag);
                                    return true;
                                }
                                return false;
                            }));

                            // add flags
                            if (updated) {
                                flagsupdate = {
                                    $addToSet: {
                                        flags: {
                                            $each: newFlags
                                        }
                                    }
                                };
                            }
                            break;
                        }

                    case 'remove':
                        {
                            // We need to use the case of existing flags when removing
                            let oldFlags = [];
                            let flagsUpdates = update.value.map(flag => flag.toLowerCase().trim());
                            message.flags = message.flags.filter(flag => {
                                if (!flagsUpdates.includes(flag.toLowerCase().trim())) {
                                    return true;
                                }
                                oldFlags.push(flag);
                                updated = true;
                                return false;
                            });

                            // remove flags
                            if (updated) {
                                flagsupdate = {
                                    $pull: {
                                        flags: {
                                            $in: oldFlags
                                        }
                                    }
                                };
                            }
                            break;
                        }
                }

                if (!update.silent) {
                    // print updated state of the message
                    session.writeStream.write(session.formatResponse('FETCH', message.uid, {
                        uid: update.isUid ? message.uid : false,
                        flags: message.flags
                    }));
                }

                if (updated) {
                    db.database.collection('messages').findOneAndUpdate({
                        _id: message._id
                    }, flagsupdate, {}, err => {
                        if (err) {
                            return cursor.close(() => done(err));
                        }

                        notifyEntries.push({
                            command: 'FETCH',
                            ignore: session.id,
                            uid: message.uid,
                            flags: message.flags,
                            message: message._id
                        });

                        if (notifyEntries.length > 100) {
                            // emit notifications in batches of 100
                            let entries = notifyEntries;
                            notifyEntries = [];
                            setImmediate(() => this.notifier.addEntries(session.user.id, path, entries, processNext));
                            return;
                        } else {
                            setImmediate(() => processNext());
                        }
                    });
                } else {
                    processNext();
                }
            });
        };

        processNext();
    });
};

// EXPUNGE deletes all messages in selected mailbox marked with \Delete
server.onExpunge = function (path, update, session, callback) {
    this.logger.debug('[%s] Deleting messages from "%s"', session.id, path);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        let cursor = db.database.collection('messages').find({
            mailbox: mailbox._id,
            flags: '\\Deleted'
        }).project({
            _id: true,
            uid: true,
            size: true
        }).sort([
            ['uid', 1]
        ]);

        let deletedMessages = 0;
        let deletedStorage = 0;

        let updateQuota = next => {
            if (!deletedMessages) {
                return next();
            }

            db.database.collection('users').findOneAndUpdate({
                _id: mailbox.user
            }, {
                $inc: {
                    storageUsed: -deletedStorage
                }
            }, next);
        };

        let processNext = () => {
            cursor.next((err, message) => {
                if (err) {
                    return updateQuota(() => callback(err));
                }
                if (!message) {
                    return cursor.close(() => {
                        updateQuota(() => {
                            this.notifier.fire(session.user.id, path);

                            // delete all attachments that do not have any active links to message objects
                            db.database.collection('attachments.files').deleteMany({
                                'metadata.messages': {
                                    $size: 0
                                }
                            }, err => {
                                if (err) {
                                    // ignore as we don't really care if we have orphans or not
                                }

                                return callback(null, true);
                            });
                        });
                    });
                }

                if (!update.silent) {
                    session.writeStream.write(session.formatResponse('EXPUNGE', message.uid));
                }

                db.database.collection('messages').deleteOne({
                    _id: message._id
                }, err => {
                    if (err) {
                        return updateQuota(() => cursor.close(() => callback(err)));
                    }

                    deletedMessages++;
                    deletedStorage += Number(message.size) || 0;

                    // remove link to message from attachments (if any exist)
                    db.database.collection('attachments.files').updateMany({
                        'metadata.messages': message._id
                    }, {
                        $pull: {
                            'metadata.messages': message._id
                        }
                    }, {
                        multi: true,
                        w: 1
                    }, err => {
                        if (err) {
                            // ignore as we don't really care if we have orphans or not
                        }
                        this.notifier.addEntries(session.user.id, path, {
                            command: 'EXPUNGE',
                            ignore: session.id,
                            uid: message.uid,
                            message: message._id
                        }, processNext);
                    });
                });
            });
        };

        processNext();
    });
};

// COPY / UID COPY sequence mailbox
server.onCopy = function (path, update, session, callback) {
    this.logger.debug('[%s] Copying messages from "%s" to "%s"', session.id, path, update.destination);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        db.database.collection('mailboxes').findOne({
            user: session.user.id,
            path: update.destination
        }, (err, target) => {
            if (err) {
                return callback(err);
            }
            if (!target) {
                return callback(null, 'TRYCREATE');
            }

            let cursor = db.database.collection('messages').find({
                mailbox: mailbox._id,
                uid: {
                    $in: update.messages
                }
            }).sort([
                ['uid', 1]
            ]); // no projection as we need to copy the entire message

            let copiedMessages = 0;
            let copiedStorage = 0;

            let updateQuota = next => {
                if (!copiedMessages) {
                    return next();
                }
                db.database.collection('users').findOneAndUpdate({
                    _id: mailbox.user
                }, {
                    $inc: {
                        storageUsed: copiedStorage
                    }
                }, next);
            };

            let sourceUid = [];
            let destinationUid = [];
            let processNext = () => {
                cursor.next((err, message) => {
                    if (err) {
                        return updateQuota(() => callback(err));
                    }
                    if (!message) {
                        return cursor.close(() => {
                            updateQuota(() => {
                                this.notifier.fire(session.user.id, target.path);
                                return callback(null, true, {
                                    uidValidity: target.uidValidity,
                                    sourceUid,
                                    destinationUid
                                });
                            });
                        });
                    }

                    let sourceId = message._id;

                    sourceUid.unshift(message.uid);
                    db.database.collection('mailboxes').findOneAndUpdate({
                        _id: target._id
                    }, {
                        $inc: {
                            uidNext: 1
                        }
                    }, {
                        uidNext: true
                    }, (err, item) => {
                        if (err) {
                            return updateQuota(() => callback(err));
                        }

                        if (!item || !item.value) {
                            // was not able to acquire a lock
                            return updateQuota(() => callback(null, 'TRYCREATE'));
                        }

                        let uidNext = item.value.uidNext;
                        destinationUid.unshift(uidNext);

                        message._id = new ObjectID();
                        message.mailbox = target._id;
                        message.uid = uidNext;

                        if (!message.meta) {
                            message.meta = {};
                        }
                        message.meta.source = 'IMAPCOPY';

                        db.database.collection('messages').insertOne(message, err => {
                            if (err) {
                                return updateQuota(() => callback(err));
                            }

                            copiedMessages++;
                            copiedStorage += Number(message.size) || 0;

                            // remove link to message from attachments (if any exist)
                            db.database.collection('attachments.files').updateMany({
                                'metadata.messages': sourceId
                            }, {
                                $push: {
                                    'metadata.messages': message._id
                                }
                            }, {
                                multi: true,
                                w: 1
                            }, err => {
                                if (err) {
                                    // should we care about this error?
                                }
                                this.notifier.addEntries(session.user.id, target.path, {
                                    command: 'EXISTS',
                                    uid: message.uid,
                                    message: message._id
                                }, processNext);
                            });
                        });
                    });
                });
            };

            processNext();

        });
    });
};

// MOVE / UID MOVE sequence mailbox
server.onMove = function (path, update, session, callback) {
    this.logger.debug('[%s] Moving messages from "%s" to "%s"', session.id, path, update.destination);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        db.database.collection('mailboxes').findOne({
            user: session.user.id,
            path: update.destination
        }, (err, target) => {
            if (err) {
                return callback(err);
            }
            if (!target) {
                return callback(null, 'TRYCREATE');
            }

            let cursor = db.database.collection('messages').find({
                mailbox: mailbox._id,
                uid: {
                    $in: update.messages
                }
            }).project({
                uid: 1
            }).sort([
                ['uid', 1]
            ]);

            let sourceUid = [];
            let destinationUid = [];

            let processNext = () => {
                cursor.next((err, message) => {
                    if (err) {
                        return callback(err);
                    }
                    if (!message) {
                        return cursor.close(() => {
                            db.database.collection('mailboxes').findOneAndUpdate({
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
                                this.notifier.fire(session.user.id, target.path);
                                return callback(null, true, {
                                    uidValidity: target.uidValidity,
                                    sourceUid,
                                    destinationUid
                                });
                            });
                        });
                    }

                    sourceUid.unshift(message.uid);
                    db.database.collection('mailboxes').findOneAndUpdate({
                        _id: target._id
                    }, {
                        $inc: {
                            uidNext: 1
                        }
                    }, {
                        uidNext: true
                    }, (err, item) => {
                        if (err) {
                            return callback(err);
                        }

                        if (!item || !item.value) {
                            // was not able to acquire a lock
                            return callback(null, 'TRYCREATE');
                        }

                        let uidNext = item.value.uidNext;
                        destinationUid.unshift(uidNext);

                        // update message, change mailbox from old to new one
                        db.database.collection('messages').findOneAndUpdate({
                            _id: message._id
                        }, {
                            $set: {
                                mailbox: target._id,
                                // new mailbox means new UID
                                uid: uidNext,
                                // this will be changed later by the notification system
                                modseq: 0
                            }
                        }, err => {
                            if (err) {
                                return callback(err);
                            }

                            session.writeStream.write(session.formatResponse('EXPUNGE', message.uid));

                            // mark messages as deleted from old mailbox
                            this.notifier.addEntries(session.user.id, path, {
                                command: 'EXPUNGE',
                                ignore: session.id,
                                uid: message.uid
                            }, () => {
                                // mark messages as added to old mailbox
                                this.notifier.addEntries(session.user.id, target.path, {
                                    command: 'EXISTS',
                                    uid: uidNext,
                                    message: message._id
                                }, processNext);
                            });
                        });
                    });
                });
            };

            processNext();
        });
    });
};

// sends results to socket
server.onFetch = function (path, options, session, callback) {
    this.logger.debug('[%s] Requested FETCH for "%s"', session.id, path);
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        let projection = {
            uid: true,
            modseq: true,
            internaldate: true,
            flags: true,
            envelope: true,
            bodystructure: true,
            size: true
        };

        if (!options.metadataOnly) {
            projection.mimeTree = true;
        }

        let query = {
            mailbox: mailbox._id,
            uid: {
                $in: options.messages
            }
        };

        if (options.changedSince) {
            query.modseq = {
                $gt: options.changedSince
            };
        }

        let cursor = db.database.collection('messages').find(query).project(projection).sort([
            ['uid', 1]
        ]);

        let processNext = () => {
            cursor.next((err, message) => {
                if (err) {
                    return callback(err);
                }
                if (!message) {
                    return cursor.close(() => {
                        this.notifier.fire(session.user.id, path);
                        return callback(null, true);
                    });
                }

                let markAsSeen = options.markAsSeen && !message.flags.includes('\\Seen');
                if (markAsSeen) {
                    message.flags.unshift('\\Seen');
                }

                let stream = imapHandler.compileStream(session.formatResponse('FETCH', message.uid, {
                    query: options.query,
                    values: session.getQueryResponse(options.query, message, {
                        logger: this.logger,
                        fetchOptions: {},
                        database: db.database,
                        acceptUTF8Enabled: session.isUTF8Enabled()
                    })
                }));

                stream.on('error', err => {
                    session.socket.write('INTERNAL ERROR\n');
                    session.socket.destroy(); // ended up in erroneus state, kill the connection to abort
                    return cursor.close(() => callback(err));
                });

                // send formatted response to socket
                session.writeStream.write(stream, () => {

                    if (!options.markAsSeen || message.flags.includes('\\Seen')) {
                        return processNext();
                    }

                    if (!markAsSeen) {
                        return processNext();
                    }

                    this.logger.debug('[%s] UPDATE FLAGS for "%s"', session.id, message.uid);

                    db.database.collection('messages').findOneAndUpdate({
                        _id: message._id
                    }, {
                        $addToSet: {
                            flags: '\\Seen'
                        }
                    }, {}, err => {
                        if (err) {
                            return cursor.close(() => callback(err));
                        }
                        this.notifier.addEntries(session.user.id, path, {
                            command: 'FETCH',
                            ignore: session.id,
                            uid: message.uid,
                            flags: message.flags,
                            message: message._id
                        }, processNext);
                    });
                });
            });
        };

        processNext();
    });
};

/**
 * Returns an array of matching UID values
 *
 * IMAP search can be quite complex, so we optimize here for most common queries to be handled
 * by MongoDB and then do the final filtering on the client side. This allows
 */
server.onSearch = function (path, options, session, callback) {
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        // prepare query

        let query = {
            mailbox: mailbox._id,
            $and: []
        };

        let projection = {
            uid: true,
            //internaldate: true,
            //headerdate: true,
            //flags: true,
            modseq: true
        };

        //if (options.terms.includes('body') || options.terms.includes('text') || options.terms.includes('header')) {
        //    projection.mimeTree = true;
        //}

        //if (!options.terms.includes('all')) {

        let hasAll = false;
        let walkQuery = (parent, ne, node) => {
            if (hasAll) {
                return;
            }
            node.forEach(term => {
                switch (term.key) {
                    case 'all':
                        if (!ne) {
                            hasAll = true;
                            query = {
                                mailbox: mailbox._id
                            };
                        }
                        break;

                    case 'not':
                        walkQuery(parent, !ne, [].concat(term.value || []));
                        break;

                    case 'or':
                        {
                            let $or = [];
                            parent.push({
                                $or
                            });

                            [].concat(term.value || []).forEach(entry => {
                                walkQuery($or, false, [].concat(entry || []));
                            });

                            break;
                        }

                    case 'text':
                        // TODO: search over full content
                        parent.push({
                            size: -1
                        });
                        break;

                    case 'body':
                        // TODO: search over body text
                        parent.push({
                            size: -1
                        });
                        break;

                    case 'modseq':
                        parent.push({
                            modseq: {
                                [!ne ? '$gte' : '$lt']: term.value
                            }
                        });
                        break;

                    case 'uid':
                        if (Array.isArray(term.value)) {
                            if (!term.value.length) {
                                // trying to find a message that does not exist
                                return callback(null, {
                                    uidList: [],
                                    highestModseq: 0
                                });
                            }
                            parent.push({
                                uid: {
                                    [!ne ? '$in' : '$nin']: term.value
                                }
                            });
                        } else {
                            parent.push({
                                uid: {
                                    [!ne ? '$eq' : '$ne']: term.value
                                }
                            });
                        }
                        break;

                    case 'flag':
                        {
                            if (term.exists) {
                                parent.push({
                                    flags: {
                                        [!ne ? '$eq' : '$ne']: term.value
                                    }
                                });
                            } else {
                                parent.push({
                                    flags: {
                                        [!ne ? '$ne' : '$eq']: term.value
                                    }
                                });
                            }
                        }
                        break;

                    case 'header':
                        {
                            let entry = term.value ? {
                                'headers.key': term.header,
                                'headers.value': {
                                    // FIXME: this does not match unicode symbols for whatever reason
                                    $regex: Buffer.from(term.value, 'binary').toString().replace(/[-\/\\^$*+?.()|[\]{}]/g, '\\$&')
                                }
                            } : {
                                'headers.key': term.header
                            };
                            if (!ne) {
                                parent.push(entry);
                            } else {
                                parent.push({
                                    $not: entry
                                });
                            }
                        }
                        break;

                    case 'internaldate':
                        {
                            let op = false;
                            let value = new Date(term.value + ' GMT');
                            switch (term.operator) {
                                case '<':
                                    op = '$lt';
                                    break;
                                case '<=':
                                    op = '$lte';
                                    break;
                                case '>':
                                    op = '$gt';
                                    break;
                                case '>=':
                                    op = '$gte';
                                    break;
                            }
                            let entry = !op ? [{
                                $gte: value
                            }, {
                                $lt: new Date(value.getTime() + 24 * 3600 * 1000)
                            }] : {
                                [op]: value
                            };

                            entry = {
                                internaldate: entry
                            };

                            if (!ne) {
                                parent.push(entry);
                            } else {
                                parent.push({
                                    $not: entry
                                });
                            }
                        }
                        break;

                    case 'headerdate':
                        {
                            let op = false;
                            let value = new Date(term.value + ' GMT');
                            switch (term.operator) {
                                case '<':
                                    op = '$lt';
                                    break;
                                case '<=':
                                    op = '$lte';
                                    break;
                                case '>':
                                    op = '$gt';
                                    break;
                                case '>=':
                                    op = '$gte';
                                    break;
                            }
                            let entry = !op ? [{
                                $gte: value
                            }, {
                                $lt: new Date(value.getTime() + 24 * 3600 * 1000)
                            }] : {
                                [op]: value
                            };

                            entry = {
                                headerdate: entry
                            };

                            if (!ne) {
                                parent.push(entry);
                            } else {
                                parent.push({
                                    $not: entry
                                });
                            }
                        }
                        break;

                    case 'size':
                        {
                            let op = '$eq';
                            let value = Number(term.value) || 0;
                            switch (term.operator) {
                                case '<':
                                    op = '$lt';
                                    break;
                                case '<=':
                                    op = '$lte';
                                    break;
                                case '>':
                                    op = '$gt';
                                    break;
                                case '>=':
                                    op = '$gte';
                                    break;
                            }

                            let entry = {
                                [op]: value
                            };

                            entry = {
                                size: entry
                            };

                            if (!ne) {
                                parent.push(entry);
                            } else {
                                parent.push({
                                    $not: entry
                                });
                            }
                        }
                        break;
                }
            });
        };

        walkQuery(query.$and, false, options.query);
        //}

        this.logger.info('SEARCH %s', JSON.stringify(query));

        let cursor = db.database.collection('messages').find(query).
        project(projection).
        sort([
            ['uid', 1]
        ]);

        let highestModseq = 0;
        let uidList = [];

        let processNext = () => {
            cursor.next((err, message) => {
                if (err) {
                    this.logger.error('SEARCHFAIL %s error="%s"', JSON.stringify(query), err.message);
                    return callback(new Error('Can not make requested search query'));
                }
                if (!message) {
                    return cursor.close(() => callback(null, {
                        uidList,
                        highestModseq
                    }));
                }

                //if (message.raw) {
                //    message.raw = message.raw.toString();
                //}

                //session.matchSearchQuery(message, options.query, (err, match) => {
                //    if (err) {
                //        return cursor.close(() => callback(err));
                //    }

                //if (match && highestModseq < message.modseq) {
                if (highestModseq < message.modseq) {
                    highestModseq = message.modseq;
                }

                //if (match) {
                uidList.push(message.uid);
                //}

                processNext();
                //});
            });
        };

        processNext();
    });
};

server.onGetQuotaRoot = function (path, session, callback) {
    this.logger.debug('[%s] Requested quota root info for "%s"', session.id, path);

    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        db.database.collection('users').findOne({
            _id: session.user.id
        }, (err, user) => {
            if (err) {
                return callback(err);
            }
            if (!user) {
                return callback(new Error('User data not found'));
            }

            return callback(null, {
                root: '',
                quota: user.quota || server.options.maxStorage || 0,
                storageUsed: Math.max(user.storageUsed || 0, 0)
            });
        });
    });
};

server.onGetQuota = function (quotaRoot, session, callback) {
    this.logger.debug('[%s] Requested quota info for "%s"', session.id, quotaRoot);

    if (quotaRoot !== '') {
        return callback(null, 'NONEXISTENT');
    }

    db.database.collection('users').findOne({
        _id: session.user.id
    }, (err, user) => {
        if (err) {
            return callback(err);
        }
        if (!user) {
            return callback(new Error('User data not found'));
        }

        return callback(null, {
            root: '',
            quota: user.quota || server.options.maxStorage || 0,
            storageUsed: Math.max(user.storageUsed || 0, 0)
        });
    });
};

module.exports = done => {
    let start = () => {

        messageHandler = new MessageHandler(db.database);

        server.indexer = new Indexer({
            database: db.database
        });

        // setup notification system for updates
        server.notifier = new ImapNotifier({
            database: db.database
        });

        let started = false;

        server.on('error', err => {
            if (!started) {
                started = true;
                return done(err);
            }
            server.logger.error(err);
        });

        // start listening
        server.listen(config.imap.port, config.imap.host, () => {
            if (started) {
                return server.close();
            }
            started = true;
            done(null, server);
        });
    };

    let indexpos = 0;
    let ensureIndexes = () => {
        if (indexpos >= setupIndexes.length) {
            server.logger.info('Setup indexes for %s collections', setupIndexes.length);
            return start();
        }
        let index = setupIndexes[indexpos++];
        db.database.collection(index.collection).createIndexes(index.indexes, ensureIndexes);
    };
    ensureIndexes();
};
