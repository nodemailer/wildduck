'use strict';

const db = require('../db');
const tools = require('../tools');

// EXPUNGE deletes all messages in selected mailbox marked with \Delete
module.exports = (server, messageHandler) => (mailbox, update, session, callback) => {
    server.logger.debug(
        {
            tnx: 'expunge',
            cid: session.id
        },
        '[%s] Deleting messages from "%s"',
        session.id,
        mailbox
    );
    db.database.collection('mailboxes').findOne(
        {
            _id: mailbox
        },
        (err, mailboxData) => {
            if (err) {
                return callback(err);
            }
            if (!mailboxData) {
                return callback(null, 'NONEXISTENT');
            }

            let query = {
                user: session.user.id,
                mailbox: mailboxData._id,
                undeleted: false,
                // uid is part of the sharding key so we need it somehow represented in the query
                uid: {}
            };

            if (update.isUid) {
                query.uid = tools.checkRangeQuery(update.messages);
            } else {
                query.uid.$gt = 0;
                query.uid.$lt = mailboxData.uidNext;
            }

            let cursor = db.database
                .collection('messages')
                .find(query)
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
                                server.notifier.fire(session.user.id);
                                if (!update.silent && session && session.selected && session.selected.uidList) {
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
                                }
                                return callback(null, true);
                            });
                        });
                    }

                    messageHandler.del(
                        {
                            messageData,
                            session,
                            // do not archive drafts
                            archive: !messageData.flags.includes('\\Draft'),
                            delayNotifications: true
                        },
                        err => {
                            if (err) {
                                server.logger.error(
                                    {
                                        tnx: 'EXPUNGE',
                                        err
                                    },
                                    'Failed to delete message id=%s. %s',
                                    messageData._id,
                                    err.message
                                );
                                return cursor.close(() => updateQuota(() => callback(err)));
                            }
                            server.logger.debug(
                                {
                                    tnx: 'EXPUNGE',
                                    err
                                },
                                'Deleted message id=%s',
                                messageData._id
                            );
                            deletedMessages++;
                            deletedStorage += Number(messageData.size) || 0;

                            if (!update.silent) {
                                session.writeStream.write(session.formatResponse('EXPUNGE', messageData.uid));
                            }

                            setImmediate(processNext);
                        }
                    );
                });
            };

            processNext();
        }
    );
};
