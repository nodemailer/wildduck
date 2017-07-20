'use strict';

const log = require('npmlog');
const config = require('wild-config');
const IMAPServerModule = require('./imap-core');
const IMAPServer = IMAPServerModule.IMAPServer;
const ImapNotifier = require('./lib/imap-notifier');
const Indexer = require('./imap-core/lib/indexer/indexer');
const MessageHandler = require('./lib/message-handler');
const UserHandler = require('./lib/user-handler');
const db = require('./lib/db');
const consts = require('./lib/consts');
const RedFour = require('redfour');
const packageData = require('./package.json');
const yaml = require('js-yaml');
const fs = require('fs');
const certs = require('./lib/certs').get('imap');
const setupIndexes = yaml.safeLoad(fs.readFileSync(__dirname + '/indexes.yaml', 'utf8')).indexes;

const onFetch = require('./lib/handlers/on-fetch');
const onAuth = require('./lib/handlers/on-auth');
const onList = require('./lib/handlers/on-list');
const onLsub = require('./lib/handlers/on-lsub');
const onSubscribe = require('./lib/handlers/on-subscribe');
const onUnsubscribe = require('./lib/handlers/on-unsubscribe');
const onCreate = require('./lib/handlers/on-create');
const onRename = require('./lib/handlers/on-rename');
const onDelete = require('./lib/handlers/on-delete');
const onOpen = require('./lib/handlers/on-open');
const onStatus = require('./lib/handlers/on-status');
const onAppend = require('./lib/handlers/on-append');
const onStore = require('./lib/handlers/on-store');
const onExpunge = require('./lib/handlers/on-expunge');
const onCopy = require('./lib/handlers/on-copy');
const onMove = require('./lib/handlers/on-move');
const onSearch = require('./lib/handlers/on-search');
const onGetQuotaRoot = require('./lib/handlers/on-get-quota-root');
const onGetQuota = require('./lib/handlers/on-get-quota');

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
    },

    maxMessage: config.imap.maxMB * 1024 * 1024,
    maxStorage: config.maxStorage * 1024 * 1024
};

if (certs) {
    serverOptions.key = certs.key;
    if (certs.ca) {
        serverOptions.ca = certs.ca;
    }
    serverOptions.cert = certs.cert;
}

const server = new IMAPServer(serverOptions);

let messageHandler;
let userHandler;
let gcTimeout;
let gcLock;

function deleteOrphanedAttachments(callback) {
    // NB! scattered query
    let cursor = db.gridfs.collection('attachments.files').find({
        'metadata.c': 0,
        'metadata.m': 0
    });

    let deleted = 0;
    let processNext = () => {
        cursor.next((err, attachment) => {
            if (err) {
                return callback(err);
            }
            if (!attachment) {
                return cursor.close(() => {
                    // delete all attachments that do not have any active links to message objects
                    callback(null, deleted);
                });
            }

            if (!attachment || (attachment.metadata && attachment.metadata.c)) {
                // skip
                return processNext();
            }

            // delete file entry first
            db.gridfs.collection('attachments.files').deleteOne({
                _id: attachment._id,
                // make sure that we do not delete a message that is already re-used
                'metadata.c': 0,
                'metadata.m': 0
            }, (err, result) => {
                if (err || !result.deletedCount) {
                    return processNext();
                }

                // delete data chunks
                db.gridfs.collection('attachments.chunks').deleteMany({
                    files_id: attachment._id
                }, err => {
                    if (err) {
                        // ignore as we don't really care if we have orphans or not
                    }

                    deleted++;
                    processNext();
                });
            });
        });
    };

    processNext();
}

function clearExpiredMessages() {
    clearTimeout(gcTimeout);
    let startTime = Date.now();

    // First, acquire the lock. This prevents multiple connected clients for deleting the same messages
    gcLock.acquireLock('gc_expired', Math.round(consts.GC_INTERVAL * 1.2) /* Lock expires if not released */, (err, lock) => {
        if (err) {
            server.logger.error(
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
            gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
            gcTimeout.unref();
            return;
        }

        let done = () => {
            gcLock.releaseLock(lock, err => {
                if (err) {
                    server.logger.error(
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
            return deleteOrphanedAttachments(() => done(null, true));
        }

        // find and delete all messages that are expired
        // NB! scattered query
        let cursor = db.database
            .collection('messages')
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
                map: true,
                magic: true,
                unseen: true
            });

        let deleted = 0;
        let clear = () =>
            cursor.close(() => {
                // delete all attachments that do not have any active links to message objects
                deleteOrphanedAttachments(() => {
                    server.logger.debug(
                        {
                            tnx: 'gc'
                        },
                        'Deleted %s messages',
                        deleted
                    );
                    done(null, true);
                });
            });

        let processNext = () => {
            if (Date.now() - startTime > consts.GC_INTERVAL * 0.8) {
                // deleting expired messages has taken too long time, cancel
                return clear();
            }

            cursor.next((err, message) => {
                if (err) {
                    return done(err);
                }
                if (!message) {
                    return clear();
                }

                server.logger.info(
                    {
                        tnx: 'gc',
                        err
                    },
                    'Deleting expired message id=%s',
                    message._id
                );

                gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);

                messageHandler.del(
                    {
                        message,
                        skipAttachments: true
                    },
                    err => {
                        if (err) {
                            return cursor.close(() => done(err));
                        }
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
    });
}

module.exports = done => {
    if (!config.imap.enabled) {
        return setImmediate(() => done(null, false));
    }

    gcLock = new RedFour({
        redis: db.redisConfig,
        namespace: 'wildduck'
    });

    gcTimeout = setTimeout(clearExpiredMessages, consts.GC_INTERVAL);
    gcTimeout.unref();

    let start = () => {
        messageHandler = new MessageHandler({ database: db.database, gridfs: db.gridfs, redis: db.redis });
        userHandler = new UserHandler({ database: db.database, users: db.users, redis: db.redis });

        server.indexer = new Indexer({
            database: db.database
        });

        // setup notification system for updates
        server.notifier = new ImapNotifier({
            database: db.database,
            redis: db.redis
        });

        let started = false;

        server.on('error', err => {
            if (!started) {
                started = true;
                return done(err);
            }
            server.logger.error(
                {
                    err
                },
                err
            );
        });

        // start listening
        server.listen(config.imap.port, config.imap.host, () => {
            if (started) {
                return server.close();
            }
            started = true;
            done(null, server);
        });

        // setup command handlers for the server instance
        server.onFetch = onFetch(server);
        server.onAuth = onAuth(server, userHandler);
        server.onList = onList(server);
        server.onLsub = onLsub(server);
        server.onSubscribe = onSubscribe(server);
        server.onUnsubscribe = onUnsubscribe(server);
        server.onCreate = onCreate(server);
        server.onRename = onRename(server);
        server.onDelete = onDelete(server);
        server.onOpen = onOpen(server);
        server.onStatus = onStatus(server);
        server.onAppend = onAppend(server, messageHandler);
        server.onStore = onStore(server);
        server.onExpunge = onExpunge(server);
        server.onCopy = onCopy(server);
        server.onMove = onMove(server, messageHandler);
        server.onSearch = onSearch(server);
        server.onGetQuotaRoot = onGetQuotaRoot(server);
        server.onGetQuota = onGetQuota(server);
    };

    let indexpos = 0;
    let ensureIndexes = next => {
        if (indexpos >= setupIndexes.length) {
            server.logger.info(
                {
                    tnx: 'mongo'
                },
                'Setup indexes for %s collections',
                setupIndexes.length
            );
            return next();
        }
        let index = setupIndexes[indexpos++];
        db[index.type || 'database'].collection(index.collection).createIndexes([index.index], (err, r) => {
            if (err) {
                server.logger.error(
                    {
                        err,
                        tnx: 'mongo'
                    },
                    'Failed creating index %s %s. %s',
                    indexpos,
                    JSON.stringify(index.index.name),
                    err.message
                );
            } else if (r.numIndexesAfter !== r.numIndexesBefore) {
                server.logger.debug(
                    {
                        tnx: 'mongo'
                    },
                    'Created index %s %s',
                    indexpos,
                    JSON.stringify(index.index.name)
                );
            } else {
                server.logger.debug(
                    {
                        tnx: 'mongo'
                    },
                    'Skipped index %s %s: %s',
                    indexpos,
                    JSON.stringify(index.index.name),
                    r.note || 'No index added'
                );
            }

            ensureIndexes(next);
        });
    };

    gcLock.acquireLock('db_indexes', 1 * 60 * 1000, (err, lock) => {
        if (err) {
            server.logger.error(
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

        ensureIndexes(() => {
            // Do not release the indexing lock immediatelly
            setTimeout(() => {
                gcLock.releaseLock(lock, err => {
                    if (err) {
                        server.logger.error(
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
};
