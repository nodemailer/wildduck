'use strict';

const config = require('config');
const uuidV1 = require('uuid/v1');
const ObjectID = require('mongodb').ObjectID;
const RedFour = require('redfour');
const Indexer = require('../imap-core/lib/indexer/indexer');
const ImapNotifier = require('./imap-notifier');
const tools = require('./tools');
const libmime = require('libmime');
const sanitizeHtml = require('sanitize-html');

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

            // trim too long values as mongodb indexed fields can not be too long
            if (Buffer.byteLength(value, 'utf-8') >= 880) {
                // value exceeds MongoDB max indexed value length
                value = Buffer.from(value).slice(0, 880).toString();
                // remove last 4 chars to be sure we do not have any incomplete unicode sequences
                value = value.substr(0, value.length - 4);
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

            this.indexer.processContent(id, mimeTree, (err, maildata) => {
                if (err) {
                    return callback(err);
                }

                let internaldate = options.date && new Date(options.date) || new Date();
                let headerdate = mimeTree.parsedHeader.date && new Date(mimeTree.parsedHeader.date) || false;

                let flags = [].concat(options.flags || []);

                if (!headerdate || headerdate.toString() === 'Invalid Date') {
                    headerdate = internaldate;
                }

                // prepare message object
                let message = {
                    _id: id,

                    internaldate,
                    headerdate,
                    flags,
                    size,

                    meta: options.meta || {},

                    headers,
                    mimeTree,
                    envelope,
                    bodystructure,
                    messageId,

                    // use boolean for more common flags
                    seen: flags.includes('\\Seen'),
                    flagged: flags.includes('\\Flagged'),
                    deleted: flags.includes('\\Deleted')
                };

                if (maildata.attachments && maildata.attachments.length) {
                    message.attachments = maildata.attachments;
                    message.hasAttachments = true;
                } else {
                    message.hasAttachments = false;
                }

                // use mailparser to parse plaintext and html content
                let maxTextLength = 200 * 1024;
                if (maildata.text) {
                    message.text = maildata.text.replace(/\r\n/g, '\n').trim();
                    message.text = message.text.length <= maxTextLength ? message.text : message.text.substr(0, maxTextLength);
                    message.intro = message.text.replace(/\s+/g, ' ').trim();
                    if (message.intro.length > 256) {
                        message.intro = message.intro.substr(0, 256) + '…';
                    }
                }
                if (maildata.html && maildata.html.length) {
                    let htmlSize = 0;
                    message.html = maildata.html.map(html => {
                        if (htmlSize >= maxTextLength) {
                            return '';
                        }

                        try {
                            html = sanitizeHtml(html.replace(/\r\n/g, '\n').trim()).trim();
                        } catch (E) {
                            html = '';
                        }

                        if (!html) {
                            return '';
                        }

                        if (htmlSize + Buffer.byteLength(html) <= maxTextLength) {
                            htmlSize += Buffer.byteLength(html);
                            return html;
                        }

                        html = html.substr(0, htmlSize + Buffer.byteLength(html) - maxTextLength);
                        htmlSize += Buffer.byteLength(html).trim();
                        return html;
                    }).filter(html => html);
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
                            storageUsed: size
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
                                    storageUsed: -size
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

                            // updated message object by setting mailbox specific values
                            message.mailbox = mailbox._id;
                            message.user = mailbox.user;
                            message.uid = mailbox.uidNext;
                            message.modseq = mailbox.modifyIndex + 1;

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

        this.database.collection('mailboxes').findOneAndUpdate({
            _id: mailbox._id
        }, {
            $inc: {
                storageUsed: Number(inc.storageUsed) || 0
            }
        }, () => {
            this.database.collection('users').findOneAndUpdate({
                _id: mailbox.user
            }, {
                $inc: {
                    storageUsed: Number(inc.storageUsed) || 0
                }
            }, callback);
        });
    }

    del(query, callback) {
        this.database.collection('messages').findOne(query, (err, message) => {
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
                        storageUsed: -message.size
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
