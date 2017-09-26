'use strict';

const log = require('npmlog');
const config = require('wild-config');
const IMAPServerModule = require('./imap-core');
const IMAPServer = IMAPServerModule.IMAPServer;
const ImapNotifier = require('./lib/imap-notifier');
const Indexer = require('./imap-core/lib/indexer/indexer');
const MessageHandler = require('./lib/message-handler');
const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const db = require('./lib/db');
const consts = require('./lib/consts');
const RedFour = require('redfour');
const packageData = require('./package.json');
const yaml = require('js-yaml');
const fs = require('fs');
const certs = require('./lib/certs').get('imap');
const setupIndexes = yaml.safeLoad(fs.readFileSync(__dirname + '/indexes.yaml', 'utf8'));

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
    disableSTARTTLS: config.imap.disableSTARTTLS,
    ignoreSTARTTLS: config.imap.ignoreSTARTTLS,

    id: {
        name: config.imap.name || 'Wild Duck IMAP Server',
        version: config.imap.version || packageData.version,
        vendor: config.imap.vendor || 'Kreata'
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
let mailboxHandler;
let gcTimeout;
let gcLock;

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
            return messageHandler.attachmentStorage.deleteOrphaned(() => done(null, true));
        }

        // find and delete all messages that are expired
        // NB! scattered query, searches over all mailboxes and thus over all shards
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
                'mimeTree.attachmentMap': true,
                magic: true,
                unseen: true
            });

        let deleted = 0;
        let clear = () =>
            cursor.close(() => {
                // delete all attachments that do not have any active links to message objects
                messageHandler.attachmentStorage.deleteOrphaned(() => {
                    if (deleted) {
                        server.logger.debug(
                            {
                                tnx: 'gc'
                            },
                            'Deleted %s messages',
                            deleted
                        );
                    }
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
        server.indexer = new Indexer({
            database: db.database
        });

        // setup notification system for updates
        server.notifier = new ImapNotifier({
            database: db.database,
            redis: db.redis
        });

        messageHandler = new MessageHandler({
            database: db.database,
            redis: db.redis,
            gridfs: db.gridfs,
            attachments: config.attachments
        });

        userHandler = new UserHandler({
            database: db.database,
            users: db.users,
            redis: db.redis,
            authlogExpireDays: config.log.authlogExpireDays
        });

        mailboxHandler = new MailboxHandler({
            database: db.database,
            users: db.users,
            redis: db.redis,
            notifier: server.notifier
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
        server.onFetch = onFetch(server, messageHandler);
        server.onAuth = onAuth(server, userHandler);
        server.onList = onList(server);
        server.onLsub = onLsub(server);
        server.onSubscribe = onSubscribe(server);
        server.onUnsubscribe = onUnsubscribe(server);
        server.onCreate = onCreate(server, mailboxHandler);
        server.onRename = onRename(server, mailboxHandler);
        server.onDelete = onDelete(server, mailboxHandler);
        server.onOpen = onOpen(server);
        server.onStatus = onStatus(server);
        server.onAppend = onAppend(server, messageHandler);
        server.onStore = onStore(server);
        server.onExpunge = onExpunge(server, messageHandler);
        server.onCopy = onCopy(server, messageHandler);
        server.onMove = onMove(server, messageHandler);
        server.onSearch = onSearch(server);
        server.onGetQuotaRoot = onGetQuotaRoot(server);
        server.onGetQuota = onGetQuota(server);
    };

    let collections = setupIndexes.collections;
    let collectionpos = 0;
    let ensureCollections = next => {
        if (collectionpos >= collections.length) {
            server.logger.info(
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
                server.logger.error(
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
            server.logger.info(
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
                server.logger.error(
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
                server.logger.debug(
                    {
                        tnx: 'mongo'
                    },
                    'Created index %s %s',
                    indexpos,
                    JSON.stringify(index.collection + '.' + index.index.name)
                );
            } else {
                server.logger.debug(
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

        ensureCollections(() => {
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
    });
};
