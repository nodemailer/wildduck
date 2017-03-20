'use strict';

const config = require('config');
const uuidV1 = require('uuid/v1');
const ObjectID = require('mongodb').ObjectID;
const RedFour = require('redfour');
const Indexer = require('../imap-core/lib/indexer/indexer');
const ImapNotifier = require('./imap-notifier');

class MessageHandler {

    constructor(database) {
        this.database = database;
        this.indexer = new Indexer({
            database
        });
        this.notifier = new ImapNotifier({
            database,
            pushOnly: true
        });
        this.redlock = new RedFour({
            redis: config.redis,
            namespace: 'wildduck'
        });
    }

    getMailbox(options, callback) {
        let query = {};
        if (options.mailbox) {
            if (typeof options.mailbox === 'object' && options.mailbox._id) {
                return setImmediate(null, options.mailbox);
            }
            query._id = options.mailbox;
        } else {
            query.username = options.username;
            query.path = options.path;
        }
        this.database.collection('mailboxes').findOne(query, (err, mailbox) => {
            if (err) {
                return callback(err);
            }

            if (!mailbox) {
                let err = new Error('Mailbox is missing');
                err.imapResponse = 'TRYCREATE';
                return callback(err);
            }

            callback(null, mailbox);
        });
    }

    add(options, callback) {

        let id = new ObjectID();

        let mimeTree = this.indexer.parseMimeTree(options.raw);

        let size = this.indexer.getSize(mimeTree);
        let bodystructure = this.indexer.getBodyStructure(mimeTree);
        let envelope = this.indexer.getEnvelope(mimeTree);

        let messageId = envelope[9] || ('<' + uuidV1() + '@wildduck.email>');

        this.getMailbox(options, (err, mailbox) => {
            if (err) {
                return callback(err);
            }

            this.indexer.storeAttachments(id, mimeTree, 50 * 1024, err => {
                if (err) {
                    return callback(err);
                }

                // Another server might be waiting for the lock like this.
                this.redlock.waitAcquireLock(mailbox._id.toString(), 30 * 1000, 10 * 1000, (err, lock) => {
                    if (err) {
                        return callback(err);
                    }

                    if (!lock || !lock.success) {
                        // did not get a insert lock in 10 seconds
                        return callback(new Error('The user you are trying to contact is receiving mail at a rate that prevents additional messages from being delivered. Please resend your message at a later time'));
                    }

                    // acquire new UID+MODSEQ
                    this.database.collection('mailboxes').findOneAndUpdate({
                        _id: mailbox._id
                    }, {
                        $inc: {
                            // allocate bot UID and MODSEQ values so when journal is later sorted by
                            // modseq then UIDs are always in ascending order
                            uidNext: 1,
                            modifyIndex: 1
                        }
                    }, (err, item) => {
                        if (err) {
                            this.redlock.releaseLock(lock, () => false);
                            return callback(err);
                        }

                        if (!item || !item.value) {
                            // was not able to acquire a lock
                            let err = new Error('Mailbox is missing');
                            err.imapResponse = 'TRYCREATE';
                            this.redlock.releaseLock(lock, () => false);
                            return callback(err);
                        }

                        let mailbox = item.value;

                        let internaldate = options.date && new Date(options.date) || new Date();
                        let headerdate = mimeTree.parsedHeader.date && new Date(mimeTree.parsedHeader.date) || false;

                        if (!headerdate || headerdate.toString() === 'Invalid Date') {
                            headerdate = internaldate;
                        }

                        let message = {
                            _id: id,
                            mailbox: mailbox._id,
                            uid: mailbox.uidNext,
                            internaldate,
                            headerdate,
                            flags: [].concat(options.flags || []),
                            size,
                            meta: options.meta || {},
                            modseq: mailbox.modifyIndex + 1,
                            mimeTree,
                            envelope,
                            bodystructure,
                            messageId
                        };

                        this.database.collection('messages').insertOne(message, err => {
                            if (err) {
                                this.redlock.releaseLock(lock, () => false);
                                return callback(err);
                            }

                            let uidValidity = mailbox.uidValidity;
                            let uid = message.uid;

                            this.notifier.addEntries(mailbox, false, {
                                command: 'EXISTS',
                                uid: message.uid,
                                message: message._id,
                                modseq: message.modseq
                            }, () => {

                                this.redlock.releaseLock(lock, () => {
                                    this.notifier.fire(mailbox.username, mailbox.path);
                                    return callback(null, true, {
                                        uidValidity,
                                        uid
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    }
}

module.exports = MessageHandler;
