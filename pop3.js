'use strict';

const config = require('config');
const log = require('npmlog');
const POP3Server = require('./lib/pop3-server');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./lib/db');

const MAX_MESSAGES = 5000;

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

            db.database.collection('messages').find({
                mailbox: mailbox._id
            }).project({
                uid: true,
                size: true
            }).sort([
                ['uid', -1]
            ]).limit(MAX_MESSAGES).toArray((err, messages) => {
                if (err) {
                    return callback(err);
                }

                return callback(null, {
                    messages: messages.map(message => ({
                        id: message._id.toString(),
                        size: message.size
                    })),
                    count: messages.length,
                    size: messages.reduce((acc, message) => acc + message.size, 0)
                });
            });
        });
    }
};

if (config.pop3.key) {
    serverOptions.key = fs.readFileSync(config.pop3.key);
}

if (config.pop3.cert) {
    serverOptions.cert = fs.readFileSync(config.pop3.cert);
}

const server = new POP3Server(serverOptions);

module.exports = done => {
    if (!config.pop3.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

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
