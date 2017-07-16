'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../db');
const tools = require('../tools');

// COPY / UID COPY sequence mailbox
module.exports = server => (path, update, session, callback) => {
    server.logger.debug(
        {
            tnx: 'copy',
            cid: session.id
        },
        '[%s] Copying messages from "%s" to "%s"',
        session.id,
        path,
        update.destination
    );
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

            let cursor = db.database
                .collection('messages')
                .find({
                    mailbox: mailbox._id,
                    uid: tools.checkRangeQuery(update.messages)
                })
                .sort([['uid', 1]]); // no projection as we need to copy the entire message

            let copiedMessages = 0;
            let copiedStorage = 0;

            let updateQuota = next => {
                if (!copiedMessages) {
                    return next();
                }
                db.users.collection('users').findOneAndUpdate(
                    {
                        _id: mailbox.user
                    },
                    {
                        $inc: {
                            storageUsed: copiedStorage
                        }
                    },
                    next
                );
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
                                server.notifier.fire(session.user.id, target.path);
                                return callback(null, true, {
                                    uidValidity: target.uidValidity,
                                    sourceUid,
                                    destinationUid
                                });
                            });
                        });
                    }

                    // Copying is not done in bulk to minimize risk of going out of sync with incremental UIDs
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
                            return cursor.close(() => {
                                updateQuota(() => callback(err));
                            });
                        }

                        if (!item || !item.value) {
                            // was not able to acquire a lock
                            return cursor.close(() => {
                                updateQuota(() => callback(null, 'TRYCREATE'));
                            });
                        }

                        let uidNext = item.value.uidNext;
                        destinationUid.unshift(uidNext);

                        message._id = new ObjectID();
                        message.mailbox = target._id;
                        message.uid = uidNext;

                        // retention settings
                        message.exp = !!target.retention;
                        message.rdate = Date.now() + (target.retention || 0);

                        if (!message.meta) {
                            message.meta = {};
                        }
                        message.meta.source = 'IMAPCOPY';

                        db.database.collection('messages').insertOne(message, err => {
                            if (err) {
                                return cursor.close(() => {
                                    updateQuota(() => callback(err));
                                });
                            }

                            copiedMessages++;
                            copiedStorage += Number(message.size) || 0;

                            let attachments = Object.keys(message.map || {}).map(key => message.map[key]);
                            if (!attachments.length) {
                                return server.notifier.addEntries(
                                    session.user.id,
                                    target.path,
                                    {
                                        command: 'EXISTS',
                                        uid: message.uid,
                                        message: message._id
                                    },
                                    processNext
                                );
                            }

                            // update attachments
                            db.gridfs.collection('attachments.files').updateMany({
                                _id: {
                                    $in: attachments
                                }
                            }, {
                                $inc: {
                                    'metadata.c': 1,
                                    'metadata.m': message.magic
                                }
                            }, {
                                multi: true,
                                w: 1
                            }, err => {
                                if (err) {
                                    // should we care about this error?
                                }
                                server.notifier.addEntries(
                                    session.user.id,
                                    target.path,
                                    {
                                        command: 'EXISTS',
                                        uid: message.uid,
                                        message: message._id
                                    },
                                    processNext
                                );
                            });
                        });
                    });
                });
            };
            processNext();
        });
    });
};
