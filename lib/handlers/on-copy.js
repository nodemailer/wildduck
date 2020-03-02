'use strict';

const ObjectID = require('mongodb').ObjectID;
const db = require('../db');
const tools = require('../tools');
const consts = require('../consts');

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

            db.database.collection('mailboxes').findOne(
                {
                    user: session.user.id,
                    path: update.destination
                },
                {
                    maxTimeMS: consts.DB_MAX_TIME_MAILBOXES
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
                        }) // no projection as we need to copy the entire message
                        .sort({ uid: 1 })
                        .maxTimeMS(consts.DB_MAX_TIME_MESSAGES);

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
                            {
                                returnOriginal: false,
                                projection: {
                                    storageUsed: true
                                },
                                maxTimeMS: consts.DB_MAX_TIME_USERS
                            },
                            (...args) => {
                                let r = args && args[1];

                                if (r && r.value) {
                                    server.loggelf({
                                        short_message: '[QUOTA] +',
                                        _mail_action: 'quota',
                                        _user: mailboxData.user,
                                        _inc: copiedStorage,
                                        _copied_messages: copiedMessages,
                                        _storage_used: r.value.storageUsed,
                                        _mailbox: targetData._id,
                                        _session: session && session.id
                                    });
                                }
                                next();
                            }
                        );
                    };

                    let sourceUid = [];
                    let destinationUid = [];
                    let processNext = () => {
                        cursor.next((err, messageData) => {
                            if (err) {
                                return updateQuota(() => callback(err));
                            }

                            if (!messageData) {
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

                            // this query points to current message
                            let existingQuery = {
                                mailbox: messageData.mailbox,
                                uid: messageData.uid,
                                _id: messageData._id
                            };

                            // Copying is not done in bulk to minimize risk of going out of sync with incremental UIDs
                            sourceUid.unshift(messageData.uid);
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
                                    returnOriginal: true,
                                    maxTimeMS: consts.DB_MAX_TIME_MAILBOXES
                                },
                                (err, item) => {
                                    if (err) {
                                        return cursor.close(() => {
                                            updateQuota(() => callback(err));
                                        });
                                    }

                                    if (!item || !item.value) {
                                        // mailbox not found
                                        return cursor.close(() => {
                                            updateQuota(() => callback(null, 'TRYCREATE'));
                                        });
                                    }

                                    let uidNext = item.value.uidNext;
                                    let modifyIndex = item.value.modifyIndex;
                                    destinationUid.unshift(uidNext);

                                    messageData._id = new ObjectID();
                                    messageData.mailbox = targetData._id;
                                    messageData.uid = uidNext;

                                    // retention settings
                                    messageData.exp = !!targetData.retention;
                                    messageData.rdate = Date.now() + (targetData.retention || 0);
                                    messageData.modseq = modifyIndex; // reset message modseq to whatever it is for the mailbox right now

                                    messageData.searchable = true;

                                    let junk = false;
                                    if (targetData.specialUse === '\\Junk' && !messageData.junk) {
                                        messageData.junk = true;
                                        junk = 1;
                                    } else if (targetData.specialUse !== '\\Trash' && messageData.junk) {
                                        delete messageData.junk;
                                        junk = -1;
                                    }

                                    if (!messageData.meta) {
                                        messageData.meta = {};
                                    }

                                    if (!messageData.meta.events) {
                                        messageData.meta.events = [];
                                    }
                                    messageData.meta.events.push({
                                        action: 'IMAPCOPY',
                                        time: new Date()
                                    });

                                    db.database.collection('messages').updateOne(
                                        existingQuery,
                                        {
                                            $set: {
                                                // indicate that we do not need to archive this message when deleted
                                                copied: true
                                            }
                                        },
                                        { w: 'majority' },
                                        () => {
                                            db.database.collection('messages').insertOne(messageData, { w: 'majority' }, (err, r) => {
                                                if (err) {
                                                    return cursor.close(() => {
                                                        updateQuota(() => callback(err));
                                                    });
                                                }

                                                if (!r || !r.insertedCount) {
                                                    return processNext();
                                                }

                                                copiedMessages++;
                                                copiedStorage += Number(messageData.size) || 0;

                                                let attachmentIds = Object.keys(messageData.mimeTree.attachmentMap || {}).map(
                                                    key => messageData.mimeTree.attachmentMap[key]
                                                );

                                                if (!attachmentIds.length) {
                                                    let entry = {
                                                        command: 'EXISTS',
                                                        uid: messageData.uid,
                                                        message: messageData._id,
                                                        unseen: messageData.unseen
                                                    };
                                                    if (junk) {
                                                        entry.junk = junk;
                                                    }
                                                    return server.notifier.addEntries(targetData, entry, processNext);
                                                }

                                                messageHandler.attachmentStorage.updateMany(attachmentIds, 1, messageData.magic, err => {
                                                    if (err) {
                                                        // should we care about this error?
                                                    }
                                                    let entry = {
                                                        command: 'EXISTS',
                                                        uid: messageData.uid,
                                                        message: messageData._id,
                                                        unseen: messageData.unseen
                                                    };
                                                    if (junk) {
                                                        entry.junk = junk;
                                                    }
                                                    server.notifier.addEntries(targetData, entry, processNext);
                                                });
                                            });
                                        }
                                    );
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
