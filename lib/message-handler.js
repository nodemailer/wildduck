'use strict';

const config = require('config');
const uuidV1 = require('uuid/v1');
const ObjectID = require('mongodb').ObjectID;
const RedFour = require('redfour');
const Indexer = require('../imap-core/lib/indexer/indexer');
const ImapNotifier = require('./imap-notifier');
const tools = require('./tools');
const libmime = require('libmime');
const createDOMPurify = require('dompurify');
const jsdom = require('jsdom');

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
            redis: tools.redisConfig(config.redis),
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
            query.user = options.user;
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

    cleanHtml(html) {
        let win = jsdom.jsdom('', {
            features: {
                FetchExternalResources: false, // disables resource loading over HTTP / filesystem
                ProcessExternalResources: false // do not execute JS within script blocks
            }
        }).defaultView;
        let domPurify = createDOMPurify(win);

        return domPurify.sanitize(html);
    }

    add(options, callback) {

        let id = new ObjectID();

        let mimeTree = this.indexer.parseMimeTree(options.raw);

        let size = this.indexer.getSize(mimeTree);
        let bodystructure = this.indexer.getBodyStructure(mimeTree);
        let envelope = this.indexer.getEnvelope(mimeTree);

        let messageId = envelope[9] || ('<' + uuidV1() + '@wildduck.email>');

        let headers = (mimeTree.header || []).map(line => {
            line = Buffer.from(line, 'binary').toString();

            let key = line.substr(0, line.indexOf(':')).trim().toLowerCase();
            let value = line.substr(line.indexOf(':') + 1).trim().toLowerCase().replace(/\s*\r?\n\s*/g, ' ');

            try {
                value = libmime.decodeWords(value);
            } catch (E) {
                // ignore
            }
            return {
                key,
                value
            };
        });

        this.getMailbox(options, (err, mailbox) => {
            if (err) {
                return callback(err);
            }

            this.indexer.processContent(id, mimeTree, 50 * 1024, (err, maildata) => {
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

                    this.database.collection('users').findOneAndUpdate({
                        _id: mailbox.user
                    }, {
                        $inc: {
                            storageUsed: size,
                            messages: 1
                        }
                    }, err => {
                        if (err) {
                            this.redlock.releaseLock(lock, () => false);
                            return callback(err);
                        }

                        let rollback = err => {
                            this.database.collection('users').findOneAndUpdate({
                                _id: mailbox.user
                            }, {
                                $inc: {
                                    storageUsed: -size,
                                    messages: -1
                                }
                            }, () => {
                                this.redlock.releaseLock(lock, () => callback(err));
                            });
                        };

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
                                return rollback(err);
                            }

                            if (!item || !item.value) {
                                // was not able to acquire a lock
                                let err = new Error('Mailbox is missing');
                                err.imapResponse = 'TRYCREATE';
                                return rollback(err);
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
                                user: mailbox.user,

                                uid: mailbox.uidNext,
                                modseq: mailbox.modifyIndex + 1,

                                internaldate,
                                headerdate,
                                flags: [].concat(options.flags || []),
                                size,

                                meta: options.meta || {},

                                headers,
                                mimeTree,
                                envelope,
                                bodystructure,
                                messageId
                            };

                            if (maildata.attachments && maildata.attachments.length) {
                                message.attachments = maildata.attachments;
                            }

                            let maxTextLength = 200 * 1024;
                            if (maildata.plain) {
                                message.text = maildata.plain.length <= maxTextLength ? maildata.plain : maildata.plain.substr(0, maxTextLength);
                            }
                            if (maildata.html) {
                                message.html = this.cleanHtml(maildata.html.replace(/\r\n/g, '\n'));
                                message.html = message.html.length <= maxTextLength ? message.html : message.html.substr(0, maxTextLength);
                            }

                            this.database.collection('messages').insertOne(message, err => {
                                if (err) {
                                    return rollback(err);
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
                                        this.notifier.fire(mailbox.user, mailbox.path);
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
        });
    }

    updateQuota(mailbox, inc, callback) {
        inc = inc || {};
        if (!inc.messages) {
            return callback();
        }

        this.database.collection('mailboxes').findOneAndUpdate({
            _id: mailbox._id
        }, {
            $inc: {
                storageUsed: Number(inc.storageUsed) || 0,
                messages: Number(inc.messages) || 0
            }
        }, () => {
            this.database.collection('users').findOneAndUpdate({
                _id: mailbox.user
            }, {
                $inc: {
                    storageUsed: Number(inc.storageUsed) || 0,
                    messages: Number(inc.messages) || 0
                }
            }, callback);
        });
    }

    del(messageId, callback) {
        this.database.collection('messages').findOne({
            _id: typeof messageId === 'string' ? new ObjectID(messageId) : messageId
        }, (err, message) => {
            if (err) {
                return callback(err);
            }

            if (!message) {
                return callback(new Error('Message does not exist'));
            }

            this.database.collection('mailboxes').findOne({
                _id: message.mailbox
            }, (err, mailbox) => {
                if (err) {
                    return callback(err);
                }

                if (!mailbox) {
                    return callback(new Error('Mailbox does not exist'));
                }

                this.database.collection('messages').deleteOne({
                    _id: message._id
                }, err => {
                    if (err) {
                        return callback(err);
                    }

                    this.updateQuota(mailbox, {
                        storageUsed: -message.size,
                        messages: -1
                    }, () => {
                        // remove link to message from attachments (if any exist)
                        this.database.collection('attachments.files').updateMany({
                            'metadata.messages': message._id
                        }, {
                            $pull: {
                                'metadata.messages': message._id
                            }
                        }, {
                            multi: true,
                            w: 1
                        }, err => {
                            if (err) {
                                // ignore as we don't really care if we have orphans or not
                            }
                            this.notifier.addEntries(mailbox, false, {
                                command: 'EXPUNGE',
                                uid: message.uid,
                                message: message._id
                            }, () => {
                                this.notifier.fire(mailbox.user, mailbox.path);

                                // delete all attachments that do not have any active links to message objects
                                this.database.collection('attachments.files').deleteMany({
                                    'metadata.messages': {
                                        $size: 0
                                    }
                                }, err => {
                                    if (err) {
                                        // ignore as we don't really care if we have orphans or not
                                    }

                                    return callback(null, true);
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
