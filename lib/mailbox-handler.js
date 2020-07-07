'use strict';

const ObjectID = require('mongodb').ObjectID;
const ImapNotifier = require('./imap-notifier');

class MailboxHandler {
    constructor(options) {
        this.database = options.database;
        this.users = options.users || options.database;
        this.redis = options.redis;

        this.loggelf = options.loggelf || (() => false);

        this.notifier =
            options.notifier ||
            new ImapNotifier({
                database: options.database,
                redis: this.redis,
                pushOnly: true
            });
    }

    create(user, path, opts, callback) {
        this.database.collection('mailboxes').findOne(
            {
                user,
                path
            },
            (err, mailboxData) => {
                if (err) {
                    return callback(err);
                }
                if (mailboxData) {
                    return callback(null, 'ALREADYEXISTS');
                }

                this.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            retention: true
                        }
                    },
                    (err, userData) => {
                        if (err) {
                            return callback(err);
                        }

                        if (!userData) {
                            return callback(new Error('User not found'));
                        }

                        mailboxData = {
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
                                mailboxData[key] = opts[key];
                            }
                        });

                        this.database.collection('mailboxes').insertOne(mailboxData, { w: 'majority' }, (err, r) => {
                            if (err) {
                                if (err.code === 11000) {
                                    return callback(null, 'ALREADYEXISTS');
                                }
                                return callback(err);
                            }
                            return this.notifier.addEntries(
                                mailboxData,
                                {
                                    command: 'CREATE',
                                    mailbox: r.insertedId,
                                    path
                                },
                                () => {
                                    this.notifier.fire(user);
                                    return callback(null, true, mailboxData._id);
                                }
                            );
                        });
                    }
                );
            }
        );
    }

    rename(user, mailbox, newname, opts, callback) {
        this.database.collection('mailboxes').findOne(
            {
                _id: mailbox,
                user
            },
            (err, mailboxData) => {
                if (err) {
                    return callback(err);
                }
                if (!mailboxData) {
                    return callback(null, 'NONEXISTENT');
                }
                if (mailboxData.path === 'INBOX' || mailboxData.hidden) {
                    return callback(null, 'CANNOT');
                }
                this.database.collection('mailboxes').findOne(
                    {
                        user: mailboxData.user,
                        path: newname
                    },
                    (err, existing) => {
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

                        this.database.collection('mailboxes').findOneAndUpdate(
                            {
                                _id: mailbox
                            },
                            {
                                $set
                            },
                            {},
                            (err, item) => {
                                if (err) {
                                    return callback(err);
                                }

                                if (!item || !item.value) {
                                    // was not able to acquire a lock
                                    return callback(null, 'NONEXISTENT');
                                }
                                this.notifier.addEntries(
                                    mailboxData,
                                    {
                                        command: 'RENAME',
                                        path: newname
                                    },
                                    () => {
                                        this.notifier.fire(mailboxData.user);
                                        return callback(null, true, mailbox);
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    }

    /**
     * Deletes a mailbox. Does not immediatelly release quota as the messages get deleted after a while
     */
    del(user, mailbox, callback) {
        this.database.collection('mailboxes').findOne(
            {
                _id: mailbox,
                user
            },
            (err, mailboxData) => {
                if (err) {
                    return callback(err);
                }
                if (!mailboxData) {
                    return callback(null, 'NONEXISTENT');
                }
                if (mailboxData.specialUse || mailboxData.path === 'INBOX' || mailboxData.hidden) {
                    return callback(null, 'CANNOT');
                }

                this.database.collection('mailboxes').deleteOne(
                    {
                        _id: mailbox
                    },
                    { w: 'majority' },
                    err => {
                        if (err) {
                            return callback(err);
                        }

                        // delete matching filters as well
                        this.database.collection('filters').deleteMany(
                            {
                                user,
                                'action.mailbox': mailbox
                            },
                            err => {
                                if (err) {
                                    this.loggelf({
                                        user,
                                        mailbox,
                                        action: 'delete_filter',
                                        error: err.message
                                    });
                                }

                                // send information about deleted mailbox straightly to connected clients
                                this.notifier.fire(mailboxData.user, {
                                    command: 'DROP',
                                    mailbox
                                });

                                this.notifier.addEntries(
                                    mailboxData,
                                    {
                                        command: 'DELETE',
                                        mailbox
                                    },
                                    () => {
                                        this.database.collection('messages').updateMany(
                                            {
                                                mailbox
                                            },
                                            {
                                                $set: {
                                                    exp: true,
                                                    // make sure the messages are in top of the expire queue
                                                    rdate: Date.now() - 24 * 3600 * 1000
                                                }
                                            },
                                            {
                                                multi: true,
                                                w: 1
                                            },
                                            err => {
                                                if (err) {
                                                    return callback(err);
                                                }

                                                let done = () => {
                                                    this.notifier.fire(mailboxData.user);
                                                    callback(null, true, mailbox);
                                                };

                                                return done();
                                            }
                                        );
                                    }
                                );
                            }
                        );
                    }
                );
            }
        );
    }

    update(user, mailbox, updates, callback) {
        if (!updates) {
            return callback(null, false);
        }

        this.database.collection('mailboxes').findOne(
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

                if (updates.path && updates.path !== mailboxData.path) {
                    return this.rename(user, mailbox, updates.path, updates, callback);
                }

                let $set = {};
                let hasChanges = false;

                Object.keys(updates || {}).forEach(key => {
                    if (!['_id', 'user', 'path'].includes(key)) {
                        $set[key] = updates[key];
                        hasChanges = true;
                    }
                });

                if (!hasChanges) {
                    return callback(null, true);
                }

                this.database.collection('mailboxes').findOneAndUpdate(
                    {
                        _id: mailbox
                    },
                    {
                        $set
                    },
                    {},
                    (err, item) => {
                        if (err) {
                            return callback(err);
                        }

                        if (!item || !item.value) {
                            return callback(null, 'NONEXISTENT');
                        }

                        return callback(null, true);
                    }
                );
            }
        );
    }
}

module.exports = MailboxHandler;
