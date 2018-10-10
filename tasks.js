'use strict';

const log = require('npmlog');
const config = require('wild-config');
const db = require('./lib/db');
const consts = require('./lib/consts');
const RedFour = require('ioredfour');
const yaml = require('js-yaml');
const fs = require('fs');
const MessageHandler = require('./lib/message-handler');
const setupIndexes = yaml.safeLoad(fs.readFileSync(__dirname + '/indexes.yaml', 'utf8'));

let logger = {
    info(...args) {
        args.shift();
        log.info('IMAP', ...args);
    },
    debug(...args) {
        args.shift();
        log.silly('IMAP', ...args);
    },
    error(...args) {
        args.shift();
        log.error('IMAP', ...args);
    }
};

let messageHandler;
let gcTimeout;
let taskTimeout;
let gcLock;

module.exports.start = callback => {
    if (!config.tasks.enabled) {
        return setImmediate(() => callback(null, false));
    }

    gcLock = new RedFour({
        redis: db.redis,
        namespace: 'wildduck'
    });

    messageHandler = new MessageHandler({
        database: db.database,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments
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
            logger.info(
                {
                    tnx: 'mongo'
                },
                'Setup %s collections',
                collections.length
            );
            return next();
        }
        let collection = collections[collectionpos++];
        db[collection.type || 'database'].createCollection(collection.collection, collection.options, err => {
            if (err) {
                logger.error(
                    {
                        err,
                        tnx: 'mongo'
                    },
                    'Failed creating collection %s %s. %s',
                    collectionpos,
                    JSON.stringify(collection.collection),
                    err.message
                );
            }

            ensureCollections(next);
        });
    };

    let indexes = setupIndexes.indexes;
    let indexpos = 0;
    let ensureIndexes = next => {
        if (indexpos >= indexes.length) {
            logger.info(
                {
                    tnx: 'mongo'
                },
                'Setup indexes for %s collections',
                indexes.length
            );
            return next();
        }
        let index = indexes[indexpos++];
        db[index.type || 'database'].collection(index.collection).createIndexes([index.index], (err, r) => {
            if (err) {
                logger.error(
                    {
                        err,
                        tnx: 'mongo'
                    },
                    'Failed creating index %s %s. %s',
                    indexpos,
                    JSON.stringify(index.collection + '.' + index.index.name),
                    err.message
                );
            } else if (r.numIndexesAfter !== r.numIndexesBefore) {
                logger.debug(
                    {
                        tnx: 'mongo'
                    },
                    'Created index %s %s',
                    indexpos,
                    JSON.stringify(index.collection + '.' + index.index.name)
                );
            } else {
                logger.debug(
                    {
                        tnx: 'mongo'
                    },
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
            logger.error(
                {
                    tnx: 'gc',
                    err
                },
                'Failed to acquire lock error=%s',
                err.message
            );
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
                            logger.error(
                                {
                                    tnx: 'gc',
                                    err
                                },
                                'Failed to release lock error=%s',
                                err.message
                            );
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
            logger.error(
                {
                    tnx: 'gc',
                    err
                },
                'Failed to acquire lock error=%s',
                err.message
            );
            gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
            gcTimeout.unref();
            return;
        } else if (!lock.success) {
            logger.debug(
                {
                    tnx: 'gc'
                },
                'Lock already acquired'
            );
            gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
            gcTimeout.unref();
            return;
        }

        logger.debug(
            {
                tnx: 'gc'
            },
            'Got lock for garbage collector'
        );

        let done = () => {
            gcLock.releaseLock(lock, err => {
                if (err) {
                    logger.error(
                        {
                            tnx: 'gc',
                            err
                        },
                        'Failed to release lock error=%s',
                        err.message
                    );
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
            logger.debug(
                {
                    tnx: 'gc'
                },
                'Archiving expired messages'
            );

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
                        logger.debug(
                            {
                                tnx: 'gc'
                            },
                            'Deleted %s messages',
                            deleted
                        );
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
                            archive: !messageData.userDeleted
                        },
                        err => {
                            if (err) {
                                logger.error(
                                    {
                                        tnx: 'gc',
                                        err
                                    },
                                    'Failed to delete expired message id=%s. %s',
                                    messageData._id,
                                    err.message
                                );
                                return cursor.close(() => done(err));
                            }
                            logger.debug(
                                {
                                    tnx: 'gc',
                                    err
                                },
                                'Deleted expired message id=%s',
                                messageData._id
                            );
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
            logger.debug(
                {
                    tnx: 'gc'
                },
                'Purging archived messages'
            );

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
                        logger.debug(
                            {
                                tnx: 'gc'
                            },
                            'Purged %s messages',
                            deleted
                        );
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
                            logger.error(
                                {
                                    tnx: 'gc',
                                    err
                                },
                                'Failed to delete archived message id=%s. %s',
                                messageData._id,
                                err.message
                            );
                            return cursor.close(() => done(err));
                        }

                        logger.debug(
                            {
                                tnx: 'gc'
                            },
                            'Deleted archived message id=%s',
                            messageData._id
                        );

                        let attachmentIds = Object.keys(messageData.mimeTree.attachmentMap || {}).map(key => messageData.mimeTree.attachmentMap[key]);

                        return db.database.collection('messagelog').insertOne(
                            {
                                id: (messageData.meta && messageData.meta.queueId) || messageData._id.toString(),
                                action: 'DELETED',
                                parentId: messageData._id,
                                created: new Date()
                            },
                            () => {
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
                            }
                        );
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
                locked: false
            }
        },
        err => {
            if (err) {
                logger.error(
                    {
                        err,
                        tnx: 'mongo'
                    },
                    'Failed releasing expired tasks. error=%s',
                    err.message
                );

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
                            lockedUntil: new Date(Date.now() + 1 * 3600 * 1000)
                        }
                    },
                    {
                        returnOriginal: false
                    },
                    (err, r) => {
                        if (err) {
                            logger.error(
                                {
                                    err,
                                    tnx: 'mongo'
                                },
                                'Failed releasing expired tasks. error=%s',
                                err.message
                            );

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

                        // we have a task to process
                        processTask(taskData, (err, release) => {
                            if (err) {
                                logger.error(
                                    {
                                        err,
                                        tnx: 'mongo'
                                    },
                                    'Failed processing task id=%s error=%s',
                                    taskData._id,
                                    err.message
                                );

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
                                db.database.collection('tasks').updateOne(
                                    {
                                        _id: taskData._id
                                    },
                                    {
                                        $set: {
                                            locked: false
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
    console.log(taskData);

    // release task by returning true
    return callback(null, true);
}
