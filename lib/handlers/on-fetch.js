'use strict';

const IMAPServerModule = require('../../imap-core');
const imapHandler = IMAPServerModule.imapHandler;
const util = require('util');
const db = require('../db');
const tools = require('../tools');
const consts = require('../consts');

module.exports = (server, messageHandler) => (path, options, session, callback) => {
    server.logger.debug(
        {
            tnx: 'fetch',
            cid: session.id
        },
        '[%s] Requested FETCH for "%s"',
        session.id,
        path
    );
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailboxData) => {
        if (err) {
            return callback(err);
        }
        if (!mailboxData) {
            return callback(null, 'NONEXISTENT');
        }

        let projection = {
            uid: true,
            modseq: true,
            idate: true,
            flags: true,
            envelope: true,
            bodystructure: true,
            size: true
        };

        if (!options.metadataOnly) {
            projection.mimeTree = true;
        }

        let query = {
            mailbox: mailboxData._id
        };

        if (options.changedSince) {
            query = {
                mailbox: mailboxData._id,
                modseq: {
                    $gt: options.changedSince
                }
            };
        }

        let queryAll = false;
        if (options.messages.length !== session.selected.uidList.length) {
            // do not use uid selector for 1:*
            query.uid = tools.checkRangeQuery(options.messages);
        } else {
            // 1:*
            queryAll = true;
            // uid is part of the sharding key so we need it somehow represented in the query
            query.uid = {
                $gt: 0,
                $lt: mailboxData.uidNext
            };
        }

        let isUpdated = false;
        let updateEntries = [];
        let notifyEntries = [];

        let done = (...args) => {
            if (updateEntries.length) {
                return db.database.collection('messages').bulkWrite(updateEntries, {
                    ordered: false,
                    w: 1
                }, () => {
                    updateEntries = [];
                    server.notifier.addEntries(session.user.id, path, notifyEntries, () => {
                        notifyEntries = [];
                        server.notifier.fire(session.user.id, path);
                        return callback(...args);
                    });
                });
            }
            if (isUpdated) {
                server.notifier.fire(session.user.id, path);
            }
            return callback(...args);
        };

        let cursor = db.database.collection('messages').find(query).project(projection).sort([['uid', 1]]);

        let rowCount = 0;
        let processNext = () => {
            cursor.next((err, message) => {
                if (err) {
                    return done(err);
                }
                if (!message) {
                    return cursor.close(() => {
                        done(null, true);
                    });
                }

                if (queryAll && !session.selected.uidList.includes(message.uid)) {
                    // skip processing messages that we do not know about yet
                    return processNext();
                }

                let markAsSeen = options.markAsSeen && !message.flags.includes('\\Seen');
                if (markAsSeen) {
                    message.flags.unshift('\\Seen');
                }

                let stream = imapHandler.compileStream(
                    session.formatResponse('FETCH', message.uid, {
                        query: options.query,
                        values: session.getQueryResponse(options.query, message, {
                            logger: server.logger,
                            fetchOptions: {},
                            database: db.database,
                            attachmentStorage: messageHandler.attachmentStorage,
                            acceptUTF8Enabled: session.isUTF8Enabled()
                        })
                    })
                );

                stream.description = util.format('* FETCH #%s uid=%s size=%sB ', ++rowCount, message.uid, message.size);

                stream.once('error', err => {
                    err.processed = true;
                    server.logger.error(
                        {
                            err,
                            tnx: 'fetch',
                            cid: session.id
                        },
                        '[%s] FETCHFAIL %s. %s',
                        session.id,
                        message._id,
                        err.message
                    );

                    session.socket.end('\n* BYE Internal Server Error\n');
                    return cursor.close(() => done());
                });

                // send formatted response to socket
                session.writeStream.write(stream, () => {
                    if (!markAsSeen) {
                        return processNext();
                    }

                    server.logger.debug(
                        {
                            tnx: 'flags',
                            cid: session.id
                        },
                        '[%s] UPDATE FLAGS for "%s"',
                        session.id,
                        message.uid
                    );

                    isUpdated = true;

                    updateEntries.push({
                        updateOne: {
                            filter: {
                                _id: message._id,
                                // include sharding key in query
                                mailbox: mailboxData._id,
                                uid: message.uid
                            },
                            update: {
                                $addToSet: {
                                    flags: '\\Seen'
                                },
                                $set: {
                                    unseen: false
                                }
                            }
                        }
                    });

                    notifyEntries.push({
                        command: 'FETCH',
                        ignore: session.id,
                        uid: message.uid,
                        flags: message.flags,
                        message: message._id,
                        unseenChange: true
                    });

                    if (updateEntries.length >= consts.BULK_BATCH_SIZE) {
                        return db.database.collection('messages').bulkWrite(updateEntries, {
                            ordered: false,
                            w: 1
                        }, err => {
                            updateEntries = [];
                            if (err) {
                                return cursor.close(() => done(err));
                            }

                            server.notifier.addEntries(session.user.id, path, notifyEntries, () => {
                                notifyEntries = [];
                                server.notifier.fire(session.user.id, path);
                                processNext();
                            });
                        });
                    } else {
                        processNext();
                    }
                });
            });
        };

        processNext();
    });
};
