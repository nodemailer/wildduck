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
const fs = require('fs');
const setupIndexes = require('./indexes.json');
const MessageHandler = require('./lib/message-handler');
const db = require('./lib/db');

// Setup server
const serverOptions = {
    secure: config.imap.secure,
    ignoreSTARTTLS: config.imap.ignoreSTARTTLS,

    id: {
        name: 'Wild Duck IMAP Server'
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
            subscribed: true
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

            db.database.collection('messages').deleteMany({
                mailbox: mailbox._id
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
                    return callback(...args);
                }));
                return;
            }
            this.notifier.fire(session.user.id, path);
            return callback(...args);
        };

        let processNext = () => {
            cursor.next((err, message) => {
                if (err) {
                    return done(err);
                }
                if (!message) {
                    return cursor.close(() => done(null, true));
                }

                let flagsupdate = {};
                let updated = false;
                switch (update.action) {
                    case 'set':
                        // check if update set matches current or is different
                        if (message.flags.length !== update.value.length || update.value.filter(flag => message.flags.indexOf(flag) < 0).length) {
                            updated = true;
                        }
                        message.flags = [].concat(update.value);
                        // set flags
                        flagsupdate.$set = {
                            flags: message.flags
                        };
                        break;

                    case 'add':
                        message.flags = message.flags.concat(update.value.filter(flag => {
                            if (message.flags.indexOf(flag) < 0) {
                                updated = true;
                                return true;
                            }
                            return false;
                        }));

                        // add flags
                        flagsupdate.$addToSet = {
                            flags: {
                                $each: update.value
                            }
                        };
                        break;

                    case 'remove':
                        message.flags = message.flags.filter(flag => {
                            if (update.value.indexOf(flag) < 0) {
                                return true;
                            }
                            updated = true;
                            return false;
                        });

                        // remove flags
                        flagsupdate.$pull = {
                            flags: {
                                $in: update.value
                            }
                        };
                        break;
                }

                if (!update.silent) {
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
            mailbox: mailbox._id
        };

        let projection = {
            uid: true,
            internaldate: true,
            headerdate: true,
            flags: true,
            modseq: true
        };

        if (options.terms.includes('body') || options.terms.includes('text') || options.terms.includes('header')) {
            projection.mimeTree = true;
        }

        if (!options.terms.includes('all')) {
            options.query.forEach(term => {
                switch (term.key) {
                    case 'modseq':
                        query.modseq = {
                            $gte: term.value
                        };
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
                            query.uid = {
                                $in: term.value
                            };
                        } else {
                            query.uid = term.value;
                        }
                        break;
                    case 'flag':
                        {
                            let entry = term.exists ? term.value : {
                                $ne: term.value
                            };

                            if (!query.$and) {
                                query.$and = [];
                            }
                            query.$and.push({
                                flags: entry
                            });
                        }
                        break;
                    case 'not':
                        [].concat(term.value || []).forEach(term => {
                            switch (term.key) {
                                case 'flag':
                                    {
                                        let entry = !term.exists ? term.value : {
                                            $ne: term.value
                                        };

                                        if (!query.$and) {
                                            query.$and = [];
                                        }
                                        query.$and.push({
                                            flags: entry
                                        });
                                    }
                                    break;
                            }
                        });
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

                            if (!query.$and) {
                                query.$and = [];
                            }
                            query.$and.push({
                                internaldate: entry
                            });
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

                            if (!query.$and) {
                                query.$and = [];
                            }
                            query.$and.push({
                                headerdate: entry
                            });
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

                            if (!query.$and) {
                                query.$and = [];
                            }

                            query.$and.push({
                                size: entry
                            });
                        }
                        break;
                }
            });
        }

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
                    return callback(err);
                }
                if (!message) {
                    return cursor.close(() => callback(null, {
                        uidList,
                        highestModseq
                    }));
                }

                if (message.raw) {
                    message.raw = message.raw.toString();
                }

                session.matchSearchQuery(message, options.query, (err, match) => {
                    if (err) {
                        return cursor.close(() => callback(err));
                    }

                    if (match && highestModseq < message.modseq) {
                        highestModseq = message.modseq;
                    }

                    if (match) {
                        uidList.push(message.uid);
                    }

                    processNext();
                });
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
            log.error('IMAP', err);
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
            log.info('mongo', 'Setup indexes for %s collections', setupIndexes.length);
            return start();
        }
        let index = setupIndexes[indexpos++];
        db.database.collection(index.collection).createIndexes(index.indexes, ensureIndexes);
    };
    ensureIndexes();
};
