'use strict';

const log = require('npmlog');
const db = require('../db');

module.exports = (taskData, options, callback) => {
    const messageHandler = options.messageHandler;

    let cursor = db.database.collection('archived').find({
        user: taskData.user,
        archived: {
            $gte: taskData.start,
            $lte: taskData.end
        }
    });

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

                mailboxes = (mailboxesList || []).forEach(mailboxData => {
                    mailboxes.set(mailboxData._id.toString(), mailboxData);
                    if (mailboxData.specialUse === '\\Trash') {
                        trashMailbox = mailboxData._id;
                    } else if (mailboxData.path === 'INBOX') {
                        inboxMailbox = mailboxData._id;
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

                        delete messageData.archived;
                        delete messageData.exp;
                        delete messageData.rdate;

                        log.info(
                            'Tasks',
                            'task=restore id=%s user=%s message=%s action=restoring target=%s',
                            taskData._id,
                            taskData.user,
                            messageData._id,
                            messageData.mailbox
                        );

                        messageHandler.put(messageData, (err, response) => {
                            if (err) {
                                log.error('Tasks', 'task=restore id=%s user=%s message=%s error=%s', taskData._id, taskData.user, messageData._id, err.message);
                                return setTimeout(processNext, 5000);
                            } else if (!response) {
                                log.error(
                                    'Tasks',
                                    'task=restore id=%s user=%s message=%s error=%s',
                                    taskData._id,
                                    taskData.user,
                                    messageData._id,
                                    'Failed to restore message'
                                );
                                return setTimeout(processNext, 1000);
                            }

                            log.info(
                                'Tasks',
                                'task=restore id=%s user=%s message=%s mailbox=%s uid=%s',
                                taskData._id,
                                taskData.user,
                                messageData._id,
                                response.mailbox,
                                response.uid
                            );

                            return db.database.collection('archived').deleteOne({ _id: messageData._id }, () => processNext());
                        });
                    });
                };

                processNext();
            });
    });
};
