'use strict';

const db = require('../db');

// DELETE "path/to/mailbox"
module.exports = server => (path, session, callback) => {
    server.logger.debug(
        {
            tnx: 'delete',
            cid: session.id
        },
        '[%s] DELETE "%s"',
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
        if (mailbox.specialUse) {
            return callback(null, 'CANNOT');
        }

        db.database.collection('mailboxes').deleteOne({
            _id: mailbox._id
        }, err => {
            if (err) {
                return callback(err);
            }

            // calculate mailbox size by aggregating the size's of all messages
            db.database
                .collection('messages')
                .aggregate(
                    [
                        {
                            $match: {
                                mailbox: mailbox._id
                            }
                        },
                        {
                            $group: {
                                _id: {
                                    mailbox: '$mailbox'
                                },
                                storageUsed: {
                                    $sum: '$size'
                                }
                            }
                        }
                    ],
                    {
                        cursor: {
                            batchSize: 1
                        }
                    }
                )
                .toArray((err, res) => {
                    if (err) {
                        return callback(err);
                    }

                    let storageUsed = (res && res[0] && res[0].storageUsed) || 0;

                    db.database.collection('messages').deleteMany({
                        mailbox: mailbox._id
                    }, err => {
                        if (err) {
                            return callback(err);
                        }

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
                        db.users.collection('users').findOneAndUpdate(
                            {
                                _id: mailbox.user
                            },
                            {
                                $inc: {
                                    storageUsed: -Number(storageUsed) || 0
                                }
                            },
                            done
                        );
                    });
                });
        });
    });
};
