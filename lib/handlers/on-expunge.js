'use strict';

const db = require('../db');

// EXPUNGE deletes all messages in selected mailbox marked with \Delete
module.exports = (server, messageHandler) => (path, update, session, callback) => {
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
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        let cursor = db.database
            .collection('messages')
            .find({
                user: session.user.id,
                mailbox: mailbox._id,
                undeleted: false
            })
            .project({
                _id: true,
                uid: true,
                size: true,
                'mimeTree.attachmentMap': true,
                magic: true,
                unseen: true
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
                    _id: mailbox.user
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
            cursor.next((err, message) => {
                if (err) {
                    return updateQuota(() => callback(err));
                }
                if (!message) {
                    return cursor.close(() => {
                        updateQuota(() => {
                            server.notifier.fire(session.user.id, path);
                            return callback(null, true);
                        });
                    });
                }

                if (!update.silent) {
                    session.writeStream.write(session.formatResponse('EXPUNGE', message.uid));
                }

                db.database.collection('messages').deleteOne({
                    _id: message._id,
                    mailbox: mailbox._id,
                    uid: message.uid
                }, err => {
                    if (err) {
                        return updateQuota(() => cursor.close(() => callback(err)));
                    }

                    deletedMessages++;
                    deletedStorage += Number(message.size) || 0;

                    let attachmentIds = Object.keys(message.mimeTree.attachmentMap || {}).map(key => message.mimeTree.attachmentMap[key]);

                    if (!attachmentIds.length) {
                        // not stored attachments
                        return server.notifier.addEntries(
                            session.user.id,
                            path,
                            {
                                command: 'EXPUNGE',
                                ignore: session.id,
                                uid: message.uid,
                                message: message._id,
                                unseen: message.unseen
                            },
                            processNext
                        );
                    }

                    messageHandler.attachmentStorage.updateMany(attachmentIds, -1, -message.magic, err => {
                        if (err) {
                            // should we care about this error?
                        }
                        server.notifier.addEntries(
                            session.user.id,
                            path,
                            {
                                command: 'EXPUNGE',
                                ignore: session.id,
                                uid: message.uid,
                                message: message._id,
                                unseen: message.unseen
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
