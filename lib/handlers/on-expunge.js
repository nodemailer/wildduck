/* eslint no-invalid-this:0 */

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
        {
            maxTimeMS: 500
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

            let logdata = {
                short_message: '[EXPUNGE]',
                _mail_action: 'expunge',
                _user: session.user.id.toString(),
                _mailbox: mailboxData._id.toString(),
                _sess: session.id,
                _deleted: 0
            };

            let deletedSize = 0;
            let updateQuota = done => {
                if (!deletedSize) {
                    return done();
                }
                // try to update quota

                messageHandler.updateQuota(
                    session.user.id,
                    {
                        storageUsed: -deletedSize,
                        mailbox: mailboxData._id
                    },
                    {
                        session
                    },
                    () => done()
                );
            };

            // fetch entire messages as these need to be copied to the archive
            let cursor = db.database
                .collection('messages')
                .find(query)
                .sort([['uid', 1]])
                .maxTimeMS(500);

            let processNext = () => {
                cursor.next((err, messageData) => {
                    if (err) {
                        return updateQuota(() => callback(err));
                    }
                    if (!messageData) {
                        server.loggelf(logdata);

                        return cursor.close(() => {
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
                            return updateQuota(() => callback(null, true));
                        });
                    }

                    messageHandler.del(
                        {
                            messageData,
                            session,
                            // do not archive drafts nor copied messages
                            archive: !messageData.flags.includes('\\Draft') && !messageData.copied,
                            delayNotifications: true
                        },
                        (err, deleted) => {
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
                                logdata._error = err.message;
                                logdata._code = err.code;
                                logdata._response = err.response;
                                server.loggelf(logdata);
                                return cursor.close(() => updateQuota(() => callback(err)));
                            }

                            if (!deleted) {
                                // nothing was deleted, so skip
                                return setImmediate(processNext);
                            }

                            logdata._deleted++;
                            deletedSize += messageData.size;

                            server.logger.debug(
                                {
                                    tnx: 'EXPUNGE',
                                    err
                                },
                                'Deleted message id=%s',
                                messageData._id
                            );

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
