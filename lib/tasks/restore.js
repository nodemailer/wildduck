'use strict';

const log = require('npmlog');
const db = require('../db');

module.exports = (taskData, options, callback) => {
    const messageHandler = options.messageHandler;

    db.users.collection('users').findOne({ _id: taskData.user }, (err, userData) => {
        if (err) {
            log.error('Tasks', 'task=restore id=%s user=%s error=%s', taskData._id, taskData.user, err.message);
            return callback(err);
        }

        if (!userData) {
            // no such user anymore
            log.error('Tasks', 'task=restore id=%s user=%s error=%s', taskData._id, taskData.user, 'No such user');
            return callback(null, true);
        }

        db.database
            .collection('mailboxes')
            .find({
                user: taskData.user
            })
            .toArray((err, mailboxesList) => {
                if (err) {
                    log.error('Tasks', 'task=restore id=%s user=%s error=%s', taskData._id, taskData.user, err.message);
                    return callback(err);
                }

                let mailboxes = new Map();
                let trashMailbox;
                let inboxMailbox;

                mailboxes = new Map();
                (mailboxesList || []).forEach(mailboxData => {
                    mailboxes.set(mailboxData._id.toString(), mailboxData);
                    if (mailboxData.specialUse === '\\Trash') {
                        trashMailbox = mailboxData._id;
                    } else if (mailboxData.path === 'INBOX') {
                        inboxMailbox = mailboxData._id;
                    }
                });

                let cursor = db.database.collection('archived').find({
                    user: taskData.user,
                    archived: {
                        $gte: taskData.start,
                        $lte: taskData.end
                    }
                });

                let processNext = () => {
                    cursor.next((err, messageData) => {
                        if (err) {
                            log.error('Tasks', 'task=restore id=%s user=%s error=%s', taskData._id, taskData.user, err.message);
                            return callback(err);
                        }

                        if (!messageData) {
                            return cursor.close(() => callback(null, true));
                        }

                        // move messages from Trash and non-existing mailboxes to INBOX
                        if (messageData.mailbox && (messageData.mailbox.equals(trashMailbox) || !mailboxes.has(messageData.mailbox.toString()))) {
                            messageData.mailbox = inboxMailbox;
                        }

                        const archived = messageData._id;

                        delete messageData.archived;
                        delete messageData.exp;
                        delete messageData.rdate;

                        // mark message as not deleted
                        messageData.flags = (messageData.flags || []).filter(flag => flag !== '\\Deleted');
                        messageData.undeleted = true;

                        log.info(
                            'Tasks',
                            'task=restore id=%s user=%s message=%s action=restoring target=%s',
                            taskData._id,
                            taskData.user,
                            archived,
                            messageData.mailbox
                        );

                        messageHandler.put(messageData, (err, response) => {
                            if (err) {
                                log.error(
                                    'Tasks',
                                    'task=restore id=%s user=%s message=%s error=%s',
                                    taskData._id,
                                    taskData.user,
                                    archived,
                                    'Failed to restore message. ' + err.message
                                );
                                return setTimeout(processNext, 5000);
                            } else if (!response) {
                                log.error(
                                    'Tasks',
                                    'task=restore id=%s user=%s message=%s error=%s',
                                    taskData._id,
                                    taskData.user,
                                    archived,
                                    'Failed to restore message'
                                );
                                return setTimeout(processNext, 1000);
                            }

                            db.users.collection('users').updateOne(
                                {
                                    _id: taskData.user
                                },
                                {
                                    $inc: {
                                        storageUsed: messageData.size
                                    }
                                },
                                err => {
                                    if (err) {
                                        // just log the error, nothing more
                                        log.error(
                                            'Tasks',
                                            'task=restore id=%s user=%s message=%s error=%s',
                                            taskData._id,
                                            taskData.user,
                                            archived,
                                            'Failed to update user quota. ' + err.message
                                        );
                                    }

                                    log.info(
                                        'Tasks',
                                        'task=restore id=%s user=%s message=%s mailbox=%s uid=%s action=restored',
                                        taskData._id,
                                        taskData.user,
                                        response.message,
                                        response.mailbox,
                                        response.uid
                                    );

                                    return db.database.collection('archived').deleteOne({ _id: archived }, (err, r) => {
                                        if (err) {
                                            log.error(
                                                'Tasks',
                                                'task=restore id=%s user=%s message=%s error=%s',
                                                taskData._id,
                                                taskData.user,
                                                archived,
                                                'Failed to delete archived message. ' + err.message
                                            );
                                        } else {
                                            log.info(
                                                'Tasks',
                                                'task=restore id=%s user=%s message=%s action=deleted count=%s',
                                                taskData._id,
                                                taskData.user,
                                                archived,
                                                r.deletedCount
                                            );
                                        }
                                        processNext();
                                    });
                                }
                            );
                        });
                    });
                };

                processNext();
            });
    });
};
