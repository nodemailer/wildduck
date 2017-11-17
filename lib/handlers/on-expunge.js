'use strict';

const consts = require('../consts');
const db = require('../db');

// EXPUNGE deletes all messages in selected mailbox marked with \Delete
module.exports = server => (path, update, session, callback) => {
    server.logger.debug(
        {
            tnx: 'expunge',
            cid: session.id
        },
        '[%s] Deleting messages from "%s"',
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

        let cursor = db.database
            .collection('messages')
            .find({
                user: session.user.id,
                mailbox: mailboxData._id,
                undeleted: false,
                // uid is part of the sharding key so we need it somehow represented in the query
                uid: {
                    $gt: 0,
                    $lt: mailboxData.uidNext
                }
            })
            .sort([['uid', 1]]);

        let deletedMessages = 0;
        let deletedStorage = 0;

        let updateQuota = next => {
            if (!deletedMessages) {
                return next();
            }

            db.users.collection('users').findOneAndUpdate(
                {
                    _id: mailboxData.user
                },
                {
                    $inc: {
                        storageUsed: -deletedStorage
                    }
                },
                next
            );
        };

        let processNext = () => {
            cursor.next((err, messageData) => {
                if (err) {
                    return updateQuota(() => callback(err));
                }
                if (!messageData) {
                    return cursor.close(() => {
                        updateQuota(() => {
                            server.notifier.fire(session.user.id, path);
                            session.writeStream.write({
                                tag: '*',
                                command: String(session.selected.uidList.length),
                                attributes: [
                                    {
                                        type: 'atom',
                                        value: 'EXISTS'
                                    }
                                ]
                            });
                            return callback(null, true);
                        });
                    });
                }

                messageData.exp = true;
                messageData.rdate = Date.now() + consts.ARCHIVE_TIME;
                db.database.collection('archived').insertOne(messageData, err => {
                    if (err) {
                        return updateQuota(() => cursor.close(() => callback(err)));
                    }

                    if (!update.silent) {
                        session.writeStream.write(session.formatResponse('EXPUNGE', messageData.uid));
                    }

                    db.database.collection('messages').deleteOne({
                        _id: messageData._id,
                        mailbox: mailboxData._id,
                        uid: messageData.uid
                    }, err => {
                        if (err) {
                            return updateQuota(() => cursor.close(() => callback(err)));
                        }

                        deletedMessages++;
                        deletedStorage += Number(messageData.size) || 0;

                        return server.notifier.addEntries(
                            session.user.id,
                            path,
                            {
                                command: 'EXPUNGE',
                                ignore: session.id,
                                uid: messageData.uid,
                                message: messageData._id,
                                unseen: messageData.unseen
                            },
                            processNext
                        );
                    });
                });
            });
        };

        processNext();
    });
};
