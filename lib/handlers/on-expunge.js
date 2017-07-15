'use strict';

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
                deleted: true
            })
            .project({
                _id: true,
                uid: true,
                size: true,
                map: true,
                magic: true
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

                    let attachments = Object.keys(message.map || {}).map(key => message.map[key]);

                    if (!attachments.length) {
                        // not stored attachments
                        return server.notifier.addEntries(
                            session.user.id,
                            path,
                            {
                                command: 'EXPUNGE',
                                ignore: session.id,
                                uid: message.uid,
                                message: message._id
                            },
                            processNext
                        );
                    }

                    // remove references to attachments (if any exist)
                    db.gridfs.collection('attachments.files').updateMany({
                        _id: {
                            $in: attachments
                        }
                    }, {
                        $inc: {
                            'metadata.c': -1,
                            'metadata.m': -message.magic
                        }
                    }, {
                        multi: true,
                        w: 1
                    }, err => {
                        if (err) {
                            // ignore as we don't really care if we have orphans or not
                        }
                        server.notifier.addEntries(
                            session.user.id,
                            path,
                            {
                                command: 'EXPUNGE',
                                ignore: session.id,
                                uid: message.uid,
                                message: message._id
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
