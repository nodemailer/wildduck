'use strict';

const config = require('config');
const log = require('npmlog');
const POP3Server = require('./lib/pop3-server');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const MessageHandler = require('./lib/message-handler');
const ObjectID = require('mongodb').ObjectID;
const db = require('./lib/db');

const MAX_MESSAGES = 250;

let messageHandler;

const serverOptions = {
    port: config.pop3.port,
    host: config.pop3.host,
    secure: config.pop3.secure,

    // log to console
    logger: {
        info(...args) {
            args.shift();
            log.info('POP3', ...args);
        },
        debug(...args) {
            args.shift();
            log.silly('POP3', ...args);
        },
        error(...args) {
            args.shift();
            log.error('POP3', ...args);
        }
    },

    onAuth(auth, session, callback) {
        db.database.collection('users').findOne({
            username: auth.username
        }, (err, user) => {
            if (err) {
                return callback(err);
            }

            if (!user || !bcrypt.compareSync(auth.password, user.password)) {
                return callback(null, {
                    message: 'Authentication failed'
                });
            }

            callback(null, {
                user: {
                    id: user._id,
                    username: user.username
                }
            });
        });
    },

    onListMessages(session, callback) {
        // only list messages in INBOX
        db.database.collection('mailboxes').findOne({
            user: session.user.id,
            path: 'INBOX'
        }, (err, mailbox) => {

            if (err) {
                return callback(err);
            }

            if (!mailbox) {
                return callback(new Error('Mailbox not found for user'));
            }

            session.user.mailbox = mailbox._id;

            db.database.collection('messages').find({
                mailbox: mailbox._id
            }).project({
                uid: true,
                size: true,
                // required to decide if we need to update flags after RETR
                flags: true,
                seen: true
            }).sort([
                ['uid', -1]
            ]).limit(MAX_MESSAGES).toArray((err, messages) => {
                if (err) {
                    return callback(err);
                }

                return callback(null, {
                    messages: messages.map(message => ({
                        id: message._id.toString(),
                        uid: message.uid,
                        size: message.size,
                        flags: message.flags,
                        seen: message.seen
                    })),
                    count: messages.length,
                    size: messages.reduce((acc, message) => acc + message.size, 0)
                });
            });
        });
    },

    onFetchMessage(id, session, callback) {
        db.database.collection('messages').findOne({
            _id: new ObjectID(id)
        }, {
            mimeTree: true,
            size: true
        }, (err, message) => {
            if (err) {
                return callback(err);
            }
            if (!message) {
                return callback(new Error('Message does not exist or is already deleted'));
            }

            let response = messageHandler.indexer.rebuild(message.mimeTree);
            if (!response || response.type !== 'stream' || !response.value) {
                return callback(new Error('Can not fetch message'));
            }

            callback(null, response.value);
        });
    },

    onUpdate(update, session, callback) {

        let handleSeen = next => {
            if (update.seen && update.seen.length) {
                return markAsSeen(session.user.mailbox, update.seen, next);
            }
            next();
        };

        handleSeen(err => {
            if (err) {
                return log.error('POP3', err);
            }
            // TODO: delete marked messages
        });

        // return callback without waiting for the update result
        setImmediate(callback);
    }
};

if (config.pop3.key) {
    serverOptions.key = fs.readFileSync(config.pop3.key);
}

if (config.pop3.cert) {
    serverOptions.cert = fs.readFileSync(config.pop3.cert);
}

const server = new POP3Server(serverOptions);

// TODO: mark as seen immediatelly after RETR instead of batching later?
function markAsSeen(mailbox, messages, callback) {
    let ids = messages.map(message => new ObjectID(message.id));

    return db.database.collection('mailboxes').findOneAndUpdate({
        _id: mailbox
    }, {
        $inc: {
            modifyIndex: 1
        }
    }, {
        returnOriginal: false
    }, (err, item) => {
        if (err) {
            return callback(err);
        }

        let mailboxData = item && item.value;
        if (!item) {
            return callback(new Error('Mailbox does not exist'));
        }

        db.database.collection('messages').updateMany({
            mailbox,
            _id: {
                $in: ids
            },
            modseq: {
                $lt: mailboxData.modifyIndex
            }
        }, {
            $set: {
                modseq: mailboxData.modifyIndex,
                seen: true
            },
            $addToSet: {
                flags: '\\Seen'
            }
        }, {
            multi: true,
            w: 1
        }, err => {
            if (err) {
                return callback(err);
            }
            messageHandler.notifier.addEntries(mailboxData, false, messages.map(message => {
                let result = {
                    command: 'FETCH',
                    uid: message.uid,
                    flags: message.flags.concat('\\Seen'),
                    message: new ObjectID(message.id),
                    modseq: mailboxData.modifyIndex
                };
                return result;
            }), () => {
                messageHandler.notifier.fire(mailboxData.user, mailboxData.path);
                callback();
            });
        });
    });
}

module.exports = done => {
    if (!config.pop3.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

    messageHandler = new MessageHandler(db.database);

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }
        log.error('POP3', err);
    });

    server.listen(config.pop3.port, config.pop3.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        done(null, server);
    });
};
