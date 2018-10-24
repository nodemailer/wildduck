'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../db');
const tools = require('../tools');

// COPY / UID COPY sequence mailbox
module.exports = (server, messageHandler) => (mailbox, update, session, callback) => {
    server.logger.debug(
        {
            tnx: 'copy',
            cid: session.id
        },
        '[%s] Copying messages from "%s" to "%s"',
        session.id,
        mailbox,
        update.destination
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

            db.database.collection('mailboxes').findOne(
                {
                    user: session.user.id,
                    path: update.destination
                },
                (err, targetData) => {
                    if (err) {
                        return callback(err);
                    }
                    if (!targetData) {
                        return callback(null, 'TRYCREATE');
                    }

                    let cursor = db.database
                        .collection('messages')
                        .find({
                            mailbox: mailboxData._id,
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
                                _id: mailboxData.user
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
                                        server.notifier.fire(session.user.id, targetData.path);
                                        return callback(null, true, {
                                            uidValidity: targetData.uidValidity,
                                            sourceUid,
                                            destinationUid
                                        });
                                    });
                                });
                            }

                            // Copying is not done in bulk to minimize risk of going out of sync with incremental UIDs
                            sourceUid.unshift(message.uid);
                            db.database.collection('mailboxes').findOneAndUpdate(
                                {
                                    _id: targetData._id
                                },
                                {
                                    $inc: {
                                        uidNext: 1
                                    }
                                },
                                {
                                    projection: {
                                        uidNext: true,
                                        modifyIndex: true
                                    },
                                    returnOriginal: true
                                },
                                (err, item) => {
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
                                    let modifyIndex = item.value.modifyIndex;
                                    destinationUid.unshift(uidNext);

                                    message._id = new ObjectID();
                                    message.mailbox = targetData._id;
                                    message.uid = uidNext;

                                    // retention settings
                                    message.exp = !!targetData.retention;
                                    message.rdate = Date.now() + (targetData.retention || 0);
                                    message.modseq = modifyIndex; // reset message modseq to whatever it is for the mailbox right now

                                    if (['\\Junk', '\\Trash'].includes(targetData.specialUse)) {
                                        delete message.searchable;
                                    } else {
                                        message.searchable = true;
                                    }

                                    let junk = false;
                                    if (targetData.specialUse === '\\Junk' && !message.junk) {
                                        message.junk = true;
                                        junk = 1;
                                    } else if (targetData.specialUse !== '\\Trash' && message.junk) {
                                        delete message.junk;
                                        junk = -1;
                                    }

                                    if (!message.meta) {
                                        message.meta = {};
                                    }

                                    if (!message.meta.events) {
                                        message.meta.events = [];
                                    }
                                    message.meta.events.push({
                                        action: 'IMAPCOPY',
                                        time: new Date()
                                    });

                                    db.database.collection('messages').insertOne(message, { w: 'majority' }, err => {
                                        if (err) {
                                            return cursor.close(() => {
                                                updateQuota(() => callback(err));
                                            });
                                        }

                                        copiedMessages++;
                                        copiedStorage += Number(message.size) || 0;

                                        let attachmentIds = Object.keys(message.mimeTree.attachmentMap || {}).map(key => message.mimeTree.attachmentMap[key]);

                                        if (!attachmentIds.length) {
                                            let entry = {
                                                command: 'EXISTS',
                                                uid: message.uid,
                                                message: message._id,
                                                unseen: message.unseen
                                            };
                                            if (junk) {
                                                entry.junk = junk;
                                            }
                                            return server.notifier.addEntries(targetData, entry, processNext);
                                        }

                                        messageHandler.attachmentStorage.updateMany(attachmentIds, 1, message.magic, err => {
                                            if (err) {
                                                // should we care about this error?
                                            }
                                            let entry = {
                                                command: 'EXISTS',
                                                uid: message.uid,
                                                message: message._id,
                                                unseen: message.unseen
                                            };
                                            if (junk) {
                                                entry.junk = junk;
                                            }
                                            server.notifier.addEntries(targetData, entry, processNext);
                                        });
                                    });
                                }
                            );
                        });
                    };
                    processNext();
                }
            );
        }
    );
};
