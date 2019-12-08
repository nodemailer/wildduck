'use strict';

const log = require('npmlog');
const config = require('wild-config');
const db = require('./lib/db');
const consts = require('./lib/consts');
const RedFour = require('ioredfour');
const yaml = require('js-yaml');
const fs = require('fs');
const MessageHandler = require('./lib/message-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const AuditHandler = require('./lib/audit-handler');
const setupIndexes = yaml.safeLoad(fs.readFileSync(__dirname + '/indexes.yaml', 'utf8'));
const Gelf = require('gelf');
const os = require('os');

const taskRestore = require('./lib/tasks/restore');
const taskUserDelete = require('./lib/tasks/user-delete');
const taskQuota = require('./lib/tasks/quota');
const taskAudit = require('./lib/tasks/audit');
const taskSnooze = require('./lib/tasks/snooze');

let messageHandler;
let mailboxHandler;
let auditHandler;
let gcTimeout;
let taskTimeout;
let gcLock;
let loggelf;

module.exports.start = callback => {
    if (!config.tasks.enabled) {
        return setImmediate(() => callback(null, false));
    }

    const component = config.log.gelf.component || 'wildduck';
    const hostname = config.log.gelf.hostname || os.hostname();
    const gelf =
        config.log.gelf && config.log.gelf.enabled
            ? new Gelf(config.log.gelf.options)
            : {
                // placeholder
                emit: () => false
            };

    loggelf = message => {
        if (typeof message === 'string') {
            message = {
                short_message: message
            };
        }

        message = message || {};

        if (!message.short_message || message.short_message.indexOf(component.toUpperCase()) !== 0) {
            message.short_message = component.toUpperCase() + ' ' + (message.short_message || '');
        }

        message.facility = component; // facility is deprecated but set by the driver if not provided
        message.host = hostname;
        message.timestamp = Date.now() / 1000;
        message._component = component;
        Object.keys(message).forEach(key => {
            if (!message[key]) {
                delete message[key];
            }
        });
        try {
            gelf.emit('gelf.log', message);
        } catch (err) {
            log.error('Gelf', err);
        }
    };

    gcLock = new RedFour({
        redis: db.redis,
        namespace: 'wildduck'
    });

    messageHandler = new MessageHandler({
        users: db.users,
        database: db.database,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments,
        loggelf: message => loggelf(message)
    });

    mailboxHandler = new MailboxHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        notifier: messageHandler.notifier,
        loggelf: message => loggelf(message)
    });

    auditHandler = new AuditHandler({
        database: db.database,
        users: db.users,
        gridfs: db.gridfs,
        bucket: 'audit',
        loggelf: message => loggelf(message)
    });

    let start = () => {
        // setup ready

        setImmediate(() => {
            gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
            gcTimeout.unref();

            // start processing pending tasks in 5 minuytes after start
            taskTimeout = setTimeout(runTasks, consts.TASK_STARTUP_INTERVAL);
            taskTimeout.unref();
        });

        return callback();
    };

    let collections = setupIndexes.collections;
    let collectionpos = 0;
    let ensureCollections = next => {
        if (collectionpos >= collections.length) {
            log.info('Setup', 'Setup %s collections in MongoDB', collections.length);
            return next();
        }
        let collection = collections[collectionpos++];
        db[collection.type || 'database'].createCollection(collection.collection, collection.options, err => {
            if (err) {
                log.error('Setup', 'Failed creating collection %s %s. %s', collectionpos, JSON.stringify(collection.collection), err.message);
            }

            ensureCollections(next);
        });
    };

    let indexes = setupIndexes.indexes;
    let indexpos = 0;
    let ensureIndexes = next => {
        if (indexpos >= indexes.length) {
            log.info('Setup', 'Setup indexes for %s collections', indexes.length);
            return next();
        }
        let index = indexes[indexpos++];
        db[index.type || 'database'].collection(index.collection).createIndexes([index.index], (err, r) => {
            if (err) {
                log.error('Setup', 'Failed creating index %s %s. %s', indexpos, JSON.stringify(index.collection + '.' + index.index.name), err.message);
            } else if (r.numIndexesAfter !== r.numIndexesBefore) {
                log.verbose('Setup', 'Created index %s %s', indexpos, JSON.stringify(index.collection + '.' + index.index.name));
            } else {
                log.verbose(
                    'Setup',
                    'Skipped index %s %s: %s',
                    indexpos,
                    JSON.stringify(index.collection + '.' + index.index.name),
                    r.note || 'No index added'
                );
            }

            ensureIndexes(next);
        });
    };

    gcLock.acquireLock('db_indexes', 1 * 60 * 1000, (err, lock) => {
        if (err) {
            log.error('GC', 'Failed to acquire lock error=%s', err.message);
            return start();
        } else if (!lock.success) {
            return start();
        }

        ensureCollections(() => {
            ensureIndexes(() => {
                // Do not release the indexing lock immediatelly
                setTimeout(() => {
                    gcLock.releaseLock(lock, err => {
                        if (err) {
                            log.error('GC', 'Failed to release lock error=%s', err.message);
                        }
                    });
                }, 60 * 1000);
                return start();
            });
        });
    });
};

function clearExpiredMessages() {
    clearTimeout(gcTimeout);
    let startTime = Date.now();

    // First, acquire the lock. This prevents multiple connected clients for deleting the same messages
    gcLock.acquireLock('gc_expired', Math.round(consts.GC_INTERVAL * 1.2) /* Lock expires if not released */, (err, lock) => {
        if (err) {
            log.error('GC', 'Failed to acquire lock error=%s', err.message);
            gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
            gcTimeout.unref();
            return;
        } else if (!lock.success) {
            log.verbose('GC', 'Lock already acquired');
            gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
            gcTimeout.unref();
            return;
        }

        log.verbose('GC', 'Got lock for garbage collector');

        let done = () => {
            gcLock.releaseLock(lock, err => {
                if (err) {
                    log.error('GC', 'Failed to release lock error=%s', err.message);
                }
                gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
                gcTimeout.unref();
            });
        };

        if (config.imap.disableRetention) {
            // delete all attachments that do not have any active links to message objects
            // do not touch expired messages
            return messageHandler.attachmentStorage.deleteOrphaned(() => done(null, true));
        }

        let deleteOrphaned = next => {
            // delete all attachments that do not have any active links to message objects
            messageHandler.attachmentStorage.deleteOrphaned(() => {
                next(null, true);
            });
        };

        let archiveExpiredMessages = next => {
            log.verbose('GC', 'Archiving expired messages');

            // find and delete all messages that are expired
            // NB! scattered query, searches over all mailboxes and thus over all shards
            let cursor = db.database.collection('messages').find({
                exp: true,
                rdate: {
                    $lte: Date.now()
                }
            });

            let deleted = 0;
            let clear = () =>
                cursor.close(() => {
                    if (deleted) {
                        log.verbose('GC', 'Deleted %s messages', deleted);
                    }
                    return deleteOrphaned(next);
                });

            let processNext = () => {
                if (Date.now() - startTime > consts.GC_INTERVAL * 0.8) {
                    // deleting expired messages has taken too long time, cancel
                    return clear();
                }

                cursor.next((err, messageData) => {
                    if (err) {
                        return done(err);
                    }
                    if (!messageData) {
                        return clear();
                    }

                    messageHandler.del(
                        {
                            messageData,
                            // do not archive messages of deleted users
                            archive: !messageData.userDeleted && !messageData.copied
                        },
                        err => {
                            if (err) {
                                log.error('GC', 'Failed to delete expired message id=%s. %s', messageData._id, err.message);
                                return cursor.close(() => done(err));
                            }
                            log.verbose('GC', 'Deleted expired message id=%s', messageData._id);
                            deleted++;
                            if (consts.GC_DELAY_DELETE) {
                                setTimeout(processNext, consts.GC_DELAY_DELETE);
                            } else {
                                setImmediate(processNext);
                            }
                        }
                    );
                });
            };

            processNext();
        };

        let purgeExpiredMessages = next => {
            log.verbose('GC', 'Purging archived messages');

            // find and delete all messages that are expired
            // NB! scattered query, searches over all mailboxes and thus over all shards
            let cursor = db.database
                .collection('archived')
                .find({
                    exp: true,
                    rdate: {
                        $lte: Date.now()
                    }
                })
                .project({
                    _id: true,
                    mailbox: true,
                    uid: true,
                    size: true,
                    'mimeTree.attachmentMap': true,
                    'meta.queueId': true,
                    magic: true,
                    unseen: true
                });

            let deleted = 0;
            let clear = () =>
                cursor.close(() => {
                    if (deleted) {
                        log.verbose('GC', 'Purged %s messages', deleted);
                    }
                    return deleteOrphaned(next);
                });

            let processNext = () => {
                if (Date.now() - startTime > consts.GC_INTERVAL * 0.8) {
                    // deleting expired messages has taken too long time, cancel
                    return clear();
                }

                cursor.next((err, messageData) => {
                    if (err) {
                        return done(err);
                    }
                    if (!messageData) {
                        return clear();
                    }

                    db.database.collection('archived').deleteOne({ _id: messageData._id }, err => {
                        if (err) {
                            //failed to delete
                            log.error('GC', 'Failed to delete archived message id=%s. %s', messageData._id, err.message);
                            return cursor.close(() => done(err));
                        }

                        log.verbose('GC', 'Deleted archived message id=%s', messageData._id);

                        let attachmentIds = Object.keys(messageData.mimeTree.attachmentMap || {}).map(key => messageData.mimeTree.attachmentMap[key]);

                        if (!attachmentIds.length) {
                            // no stored attachments
                            deleted++;
                            if (consts.GC_DELAY_DELETE) {
                                setTimeout(processNext, consts.GC_DELAY_DELETE);
                            } else {
                                setImmediate(processNext);
                            }
                            return;
                        }

                        messageHandler.attachmentStorage.updateMany(attachmentIds, -1, -messageData.magic, err => {
                            if (err) {
                                // should we care about this error?
                            }
                            deleted++;
                            if (consts.GC_DELAY_DELETE) {
                                setTimeout(processNext, consts.GC_DELAY_DELETE);
                            } else {
                                setImmediate(processNext);
                            }
                        });
                    });
                });
            };

            processNext();
        };

        archiveExpiredMessages(() => purgeExpiredMessages(done));
    });
}

function runTasks() {
    // first release expired tasks
    db.database.collection('tasks').updateMany(
        {
            locked: true,
            lockedUntil: { $lt: new Date() }
        },
        {
            $set: {
                locked: false,
                status: 'queued'
            }
        },
        err => {
            if (err) {
                log.error('Tasks', 'Failed releasing expired tasks. error=%s', err.message);

                // back off processing tasks for 5 minutes
                taskTimeout = setTimeout(runTasks, consts.TASK_STARTUP_INTERVAL);
                taskTimeout.unref();
                return;
            }

            let nextTask = () => {
                // try to fetch a new task from the queue
                db.database.collection('tasks').findOneAndUpdate(
                    {
                        locked: false
                    },
                    {
                        $set: {
                            locked: true,
                            lockedUntil: new Date(Date.now() + consts.TASK_LOCK_INTERVAL),
                            status: 'processing'
                        }
                    },
                    {
                        returnOriginal: false
                    },
                    (err, r) => {
                        if (err) {
                            log.error('Tasks', 'Failed releasing expired tasks. error=%s', err.message);

                            // back off processing tasks for 5 minutes
                            taskTimeout = setTimeout(runTasks, consts.TASK_STARTUP_INTERVAL);
                            taskTimeout.unref();
                            return;
                        }
                        if (!r || !r.value) {
                            // no pending tasks found
                            taskTimeout = setTimeout(runTasks, consts.TASK_IDLE_INTERVAL);
                            taskTimeout.unref();
                            return;
                        }

                        let taskData = r.value;

                        // keep lock alive
                        let keepAliveTimer;
                        let processed = false;
                        let keepAlive = () => {
                            clearTimeout(keepAliveTimer);
                            keepAliveTimer = setTimeout(() => {
                                if (processed) {
                                    return;
                                }
                                db.database.collection('tasks').updateOne(
                                    {
                                        _id: taskData._id,
                                        locked: true
                                    },
                                    {
                                        $set: {
                                            lockedUntil: new Date(Date.now() + consts.TASK_LOCK_INTERVAL),
                                            status: 'processing'
                                        }
                                    },
                                    (err, r) => {
                                        if (!err && !processed && r.matchedCount) {
                                            keepAlive();
                                        }
                                    }
                                );
                            }, consts.TASK_UPDATE_INTERVAL);
                            keepAliveTimer.unref();
                        };

                        keepAlive();

                        // we have a task to process
                        processTask(taskData, (err, release) => {
                            clearTimeout(keepAliveTimer);
                            processed = true;
                            if (err) {
                                log.error('Tasks', 'Failed processing task id=%s error=%s', taskData._id, err.message);

                                // back off processing tasks for 5 minutes
                                taskTimeout = setTimeout(runTasks, consts.TASK_STARTUP_INTERVAL);
                                taskTimeout.unref();
                                return;
                            }
                            if (release) {
                                db.database.collection('tasks').deleteOne(
                                    {
                                        _id: taskData._id
                                    },
                                    nextTask()
                                );
                            } else {
                                // requeue
                                db.database.collection('tasks').updateOne(
                                    {
                                        _id: taskData._id
                                    },
                                    {
                                        $set: {
                                            locked: false,
                                            status: 'queued'
                                        }
                                    },
                                    nextTask()
                                );
                            }
                        });
                    }
                );
            };
            nextTask();
        }
    );
}

function processTask(taskData, callback) {
    log.verbose('Tasks', 'task=%s', JSON.stringify(taskData));

    switch (taskData.task) {
        case 'restore':
            return taskRestore(
                taskData,
                {
                    messageHandler,
                    mailboxHandler,
                    loggelf
                },
                err => {
                    if (err) {
                        return callback(err);
                    }
                    // release
                    callback(null, true);
                }
            );

        case 'user-delete':
            return taskUserDelete(taskData, { loggelf }, err => {
                if (err) {
                    return callback(err);
                }
                // release
                callback(null, true);
            });

        case 'quota':
            return taskQuota(taskData, { loggelf }, err => {
                if (err) {
                    return callback(err);
                }
                // release
                callback(null, true);
            });

        case 'audit':
            return taskAudit(
                taskData,
                {
                    messageHandler,
                    auditHandler,
                    loggelf
                },
                err => {
                    if (err) {
                        return callback(err);
                    }
                    // release
                    callback(null, true);
                }
            );
        case 'snooze':
            return taskSnooze(
                taskData,
                {
                    messageHandler,
                    mailboxHandler,
                    loggelf
                },
                err => {
                    if (err) {
                        return callback(err);
                    }
                    // release
                    callback(null, true);
                }
            );

        default:
            // release task by returning true
            return callback(null, true);
    }
}
