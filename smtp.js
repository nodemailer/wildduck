'use strict';

const config = require('config');
const log = require('npmlog');
const SMTPServer = require('smtp-server').SMTPServer;
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const crypto = require('crypto');
const punycode = require('punycode');

let imapServer;
let database;

const server = new SMTPServer({

    // log to console
    logger: {
        info(...args) {
            args.shift();
            log.info('SMTP', ...args);
        },
        debug(...args) {
            args.shift();
            log.silly('SMTP', ...args);
        },
        error(...args) {
            args.shift();
            log.error('SMTP', ...args);
        }
    },

    name: false,

    // not required but nice-to-have
    banner: 'Welcome to Wild Duck Mail Agent',

    // disable STARTTLS to allow authentication in clear text mode
    disabledCommands: ['AUTH', 'STARTTLS'],

    // Accept messages up to 10 MB
    size: config.smtp.maxMB * 1024 * 1024,

    // Validate RCPT TO envelope address. Example allows all addresses that do not start with 'deny'
    // If this method is not set, all addresses are allowed
    onRcptTo(address, session, callback) {
        let username = normalizeAddress(address.address);

        database.collection('users').findOne({
            username
        }, (err, user) => {
            if (err) {
                log.error('SMTP', err);
                return callback(new Error('Database error'));
            }
            if (!user) {
                return callback(new Error('Unknown recipient'));
            }

            if (!session.users) {
                session.users = new Set();
            }

            session.users.add(username);

            callback();
        });
    },

    // Handle message stream
    onData(stream, session, callback) {
        let chunks = [];
        let chunklen = 0;
        let hash = crypto.createHash('md5');
        stream.on('readable', () => {
            let chunk;
            while ((chunk = stream.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
                hash.update(chunk);
            }
        });

        stream.once('error', err => {
            log.error('SMTP', err);
            callback(new Error('Error reading from stream'));
        });

        stream.once('end', () => {
            let err;
            if (stream.sizeExceeded) {
                err = new Error('Error: message exceeds fixed maximum message size ' + config.smtp.maxMB + ' MB');
                err.responseCode = 552;
                return callback(err);
            }

            if (!session.users || !session.users.size) {
                return callback(new Error('Nowhere to save the mail to'));
            }

            let users = Array.from(session.users);
            let stored = 0;
            let storeNext = () => {
                if (stored >= users.length) {
                    return callback(null, 'Message queued as ' + hash.digest('hex').toUpperCase());
                }

                let username = users[stored++];

                // add Delivered-To
                let header = Buffer.from('Delivered-To: ' + username + '\r\n');
                chunks.unshift(header);
                chunklen += header.length;

                imapServer.addToMailbox(username, 'INBOX', {
                    source: 'SMTP',
                    from: normalizeAddress(session.envelope.mailFrom && session.envelope.mailFrom.address || ''),
                    to: session.envelope.rcptTo.map(item => normalizeAddress(item.address)),
                    origin: session.remoteAddress,
                    originhost: session.clientHostname,
                    transhost: session.hostNameAppearsAs,
                    transtype: session.transmissionType,
                    time: Date.now()
                }, false, [], Buffer.concat(chunks, chunklen), err => {
                    // remove Delivered-To
                    chunks.shift();
                    chunklen -= header.length;

                    if (err) {
                        log.error('SMTP', err);
                    }

                    storeNext();
                });
            };

            storeNext();
        });
    }
});

function normalizeAddress(address, withNames) {
    if (typeof address === 'string') {
        address = {
            address
        };
    }
    if (!address || !address.address) {
        return '';
    }
    let user = address.address.substr(0, address.address.lastIndexOf('@'));
    let domain = address.address.substr(address.address.lastIndexOf('@') + 1);
    let addr = user.trim() + '@' + punycode.toASCII(domain.toLowerCase().trim());

    if (withNames) {
        return {
            name: address.name || '',
            address: addr
        };
    }

    return addr;
}

module.exports = (imap, done) => {
    if (!config.smtp.enabled) {
        return setImmediate(() => done(null, false));
    }
    MongoClient.connect(config.mongo, (err, mongo) => {
        if (err) {
            log.error('SMTP', 'Could not initialize MongoDB: %s', err.message);
            return;
        }
        database = mongo;
        imapServer = imap;

        let started = false;

        server.on('error', err => {
            if (!started) {
                started = true;
                return done(err);
            }
            log.error('SMTP', err);
        });

        server.listen(config.smtp.port, config.smtp.host, () => {
            if (started) {
                return server.close();
            }
            started = true;
            done(null, server);
        });
    });
};
