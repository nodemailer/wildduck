/* eslint no-invalid-this:0 */

'use strict';

const db = require('../db');
const tools = require('../tools');
const consts = require('../consts');

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
            maxTimeMS: consts.DB_MAX_TIME_MAILBOXES
        },
        (err, mailboxData) => {
            if (err) {
                return callback(err);
            }
            if (!mailboxData) {
                return callback(null, 'NONEXISTENT');
            }

            if (!mailboxData.user.equals(session.user.id)) {
                return callback(null, 'NONEXISTENT');
            }

            let query = {
                mailbox: mailboxData._id,
                undeleted: false
            };

            if (update.isUid) {
                query.uid = tools.checkRangeQuery(update.messages);
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

            let lockKey = ['mbwr', mailboxData._id.toString()].join(':');
            server.lock.waitAcquireLock(lockKey, 5 * 60 * 1000, 1 * 60 * 1000, (err, lock) => {
                if (err) {
                    return callback(err);
                }

                if (!lock.success) {
                    return callback(null, new Error('Failed to get folder write lock'));
                }

                // fetch entire messages as these need to be copied to the archive
                let cursor = db.database.collection('messages').find(query).sort({ uid: 1 }).maxTimeMS(consts.DB_MAX_TIME_MESSAGES);

                let processNext = () => {
                    cursor.next((err, messageData) => {
                        if (err) {
                            return server.lock.releaseLock(lock, () => {
                                updateQuota(() => callback(err));
                            });
                        }
                        if (!messageData) {
                            //server.loggelf(logdata);

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
                                return server.lock.releaseLock(lock, () => {
                                    updateQuota(() => callback(null, true));
                                });
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
                                    return cursor.close(() => server.lock.releaseLock(lock, () => updateQuota(() => callback(err))));
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
            });
        }
    );
};
