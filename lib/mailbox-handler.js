'use strict';

const ObjectID = require('mongodb').ObjectID;
const ImapNotifier = require('./imap-notifier');

class MailboxHandler {
    constructor(options) {
        this.database = options.database;
        this.users = options.users || options.database;
        this.redis = options.redis;
        this.notifier =
            options.notifier ||
            new ImapNotifier({
                database: options.database,
                redis: this.redis,
                pushOnly: true
            });
    }

    create(user, path, opts, callback) {
        this.database.collection('mailboxes').findOne({
            user,
            path
        }, (err, mailbox) => {
            if (err) {
                return callback(err);
            }
            if (mailbox) {
                return callback(null, 'ALREADYEXISTS');
            }

            this.users.collection('users').findOne({
                _id: user
            }, {
                fields: {
                    retention: true
                }
            }, (err, userData) => {
                if (err) {
                    return callback(err);
                }

                if (!userData) {
                    return callback(new Error('User not found'));
                }

                mailbox = {
                    _id: new ObjectID(),
                    user,
                    path,
                    uidValidity: Math.floor(Date.now() / 1000),
                    uidNext: 1,
                    modifyIndex: 0,
                    subscribed: true,
                    flags: [],
                    retention: userData.retention
                };

                Object.keys(opts || {}).forEach(key => {
                    if (!['_id', 'user', 'path'].includes(key)) {
                        mailbox[key] = opts[key];
                    }
                });

                this.database.collection('mailboxes').insertOne(mailbox, (err, r) => {
                    if (err) {
                        return callback(err);
                    }
                    return this.notifier.addEntries(
                        user,
                        path,
                        {
                            command: 'CREATE',
                            mailbox: r.insertedId,
                            path
                        },
                        () => {
                            this.notifier.fire(user, path);
                            return callback(null, true, mailbox._id);
                        }
                    );
                });
            });
        });
    }

    rename(user, mailbox, newname, opts, callback) {
        this.database.collection('mailboxes').findOne({
            _id: mailbox,
            user
        }, (err, mailboxData) => {
            if (err) {
                return callback(err);
            }
            if (!mailboxData) {
                return callback(null, 'NONEXISTENT');
            }
            if (mailboxData.path === 'INBOX') {
                return callback(null, 'CANNOT');
            }
            this.database.collection('mailboxes').findOne({
                user: mailboxData.user,
                path: newname
            }, (err, existing) => {
                if (err) {
                    return callback(err);
                }
                if (existing) {
                    return callback(null, 'ALREADYEXISTS');
                }

                let $set = { path: newname };

                Object.keys(opts || {}).forEach(key => {
                    if (!['_id', 'user', 'path'].includes(key)) {
                        $set[key] = opts[key];
                    }
                });

                this.database.collection('mailboxes').findOneAndUpdate({
                    _id: mailbox
                }, {
                    $set
                }, {}, (err, item) => {
                    if (err) {
                        return callback(err);
                    }

                    if (!item || !item.value) {
                        // was not able to acquire a lock
                        return callback(null, 'NONEXISTENT');
                    }
                    this.notifier.addEntries(
                        mailboxData,
                        false,
                        {
                            command: 'RENAME',
                            path: newname
                        },
                        () => {
                            this.notifier.fire(mailboxData.user, mailboxData.path);
                            return callback(null, true);
                        }
                    );
                });
            });
        });
    }

    del(user, mailbox, callback) {
        this.database.collection('mailboxes').findOne({
            _id: mailbox,
            user
        }, (err, mailboxData) => {
            if (err) {
                return callback(err);
            }
            if (!mailboxData) {
                return callback(null, 'NONEXISTENT');
            }
            if (mailboxData.specialUse || mailboxData.path === 'INBOX') {
                return callback(null, 'CANNOT');
            }

            this.database.collection('mailboxes').deleteOne({
                _id: mailbox
            }, err => {
                if (err) {
                    return callback(err);
                }

                this.notifier.addEntries(
                    mailboxData,
                    false,
                    {
                        command: 'DROP',
                        mailbox
                    },
                    () => {
                        // calculate mailbox size by aggregating the size's of all messages
                        this.database
                            .collection('messages')
                            .aggregate(
                                [
                                    {
                                        $match: {
                                            mailbox
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

                                this.database.collection('messages').deleteMany({
                                    mailbox: mailbox._id
                                }, err => {
                                    if (err) {
                                        return callback(err);
                                    }

                                    let done = () => {
                                        this.notifier.fire(mailboxData.user, mailboxData.path);
                                        callback(null, true);
                                    };

                                    if (!storageUsed) {
                                        return done();
                                    }

                                    // decrement quota counters
                                    this.users.collection('users').findOneAndUpdate(
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
                    }
                );
            });
        });
    }

    update(user, mailbox, updates, callback) {
        if (!updates) {
            return callback(null, false);
        }

        this.database.collection('mailboxes').findOne({
            _id: mailbox
        }, (err, mailboxData) => {
            if (err) {
                return callback(err);
            }
            if (!mailboxData) {
                return callback(null, 'NONEXISTENT');
            }
            if (updates.path !== mailboxData.path) {
                return this.rename(user, mailbox, updates.path, updates, callback);
            }

            let $set = {};

            Object.keys(updates || {}).forEach(key => {
                if (!['_id', 'user', 'path'].includes(key)) {
                    $set[key] = updates[key];
                }
            });

            this.database.collection('mailboxes').findOneAndUpdate({
                _id: mailbox
            }, {
                $set
            }, {}, (err, item) => {
                if (err) {
                    return callback(err);
                }

                if (!item || !item.value) {
                    // was not able to acquire a lock
                    return callback(null, 'NONEXISTENT');
                }

                return callback(null, true);
            });
        });
    }
}

module.exports = MailboxHandler;
