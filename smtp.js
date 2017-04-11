'use strict';

const config = require('config');
const log = require('npmlog');
const SMTPServer = require('smtp-server').SMTPServer;
const crypto = require('crypto');
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
const MessageSplitter = require('./lib/message-splitter');
const os = require('os');
const db = require('./lib/db');

const maxStorage = config.imap.maxStorage * 1024 * 1024;
const maxMessageSize = config.smtp.maxMB * 1024 * 1024;

let messageHandler;

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
    size: maxMessageSize,

    onMailFrom(address, session, callback) {

        // reset session entries
        session.users = new Map();

        // accept sender address
        return callback();
    },

    // Validate RCPT TO envelope address. Example allows all addresses that do not start with 'deny'
    // If this method is not set, all addresses are allowed
    onRcptTo(rcpt, session, callback) {
        let originalRecipient = tools.normalizeAddress(rcpt.address);
        let recipient = originalRecipient.replace(/\+[^@]*@/, '@');

        if (session.users.has(recipient)) {
            return callback();
        }

        db.database.collection('addresses').findOne({
            address: recipient
        }, (err, address) => {
            if (err) {
                log.error('SMTP', err);
                return callback(new Error('Database error'));
            }
            if (!address) {
                return callback(new Error('Unknown recipient'));
            }

            db.database.collection('users').findOne({
                _id: address.user
            }, (err, user) => {
                if (err) {
                    log.error('SMTP', err);
                    return callback(new Error('Database error'));
                }
                if (!user) {
                    return callback(new Error('Unknown recipient'));
                }

                if (!session.users) {
                    session.users = new Map();
                }

                let storageAvailable = (Number(user.quota || 0) || maxStorage) - Number(user.storageUsed || 0);

                if (storageAvailable <= 0) {
                    err = new Error('Insufficient channel storage: ' + originalRecipient);
                    err.responseCode = 452;
                    return callback(err);
                }

                session.users.set(recipient, {
                    recipient: originalRecipient,
                    user: address.user
                });

                callback();
            });
        });
    },

    // Handle message stream
    onData(stream, session, callback) {
        let chunks = [];
        let chunklen = 0;
        let hash = crypto.createHash('md5');

        let splitter = new MessageSplitter();

        splitter.on('readable', () => {
            let chunk;
            while ((chunk = splitter.read()) !== null) {
                if (chunklen < maxMessageSize) {
                    chunks.push(chunk);
                    chunklen += chunk.length;
                }
                hash.update(chunk);
            }
        });

        stream.once('error', err => {
            log.error('SMTP', err);
            callback(new Error('Error reading from stream'));
        });

        splitter.once('end', () => {
            let err;

            // too large message
            if (stream.sizeExceeded) {
                err = new Error('Error: message exceeds fixed maximum message size ' + config.smtp.maxMB + ' MB');
                err.responseCode = 552;
                return callback(err);
            }

            // no recipients defined
            if (!session.users || !session.users.size) {
                return callback(new Error('Nowhere to save the mail to'));
            }

            chunks.unshift(splitter.rawHeaders);
            chunklen += splitter.rawHeaders.length;

            let queueId = hash.digest('hex').toUpperCase();
            let users = Array.from(session.users);
            let stored = 0;
            let storeNext = () => {
                if (stored >= users.length) {
                    return callback(null, 'Message queued as ' + queueId);
                }

                let recipient = users[stored][0];
                let rcptData = users[stored][1] || {};
                stored++;

                // create Delivered-To and Received headers
                let header = Buffer.from(
                    'Delivered-To: ' + recipient + '\r\n' +
                    'Received: ' + generateReceivedHeader(session, queueId, os.hostname(), recipient) + '\r\n'
                );

                chunks.unshift(header);
                chunklen += header.length;

                let mailboxQueryKey = 'path';
                let mailboxQueryValue = 'INBOX';

                if (Array.isArray(splitter.headers)) {
                    for (let i = splitter.headers.length - 1; i >= 0; i--) {
                        let header = splitter.headers[i];

                        // check if the header is used for detecting spam
                        if (config.spamHeader && config.spamHeader.toLowerCase() === header.key) {
                            let value = header.line.substr(header.line.indexOf(':') + 1).trim();
                            if (/^yes\b/i.test(value)) {
                                mailboxQueryKey = 'specialUse';
                                mailboxQueryValue = '\\Junk';
                            }
                        }
                    }
                }

                messageHandler.add({
                    user: rcptData.user,
                    [mailboxQueryKey]: mailboxQueryValue,
                    meta: {
                        source: 'SMTP',
                        from: tools.normalizeAddress(session.envelope.mailFrom && session.envelope.mailFrom.address || ''),
                        to: rcptData.recipient,
                        origin: session.remoteAddress,
                        originhost: session.clientHostname,
                        transhost: session.hostNameAppearsAs,
                        transtype: session.transmissionType,
                        time: Date.now()
                    },
                    date: false,
                    flags: false,
                    raw: Buffer.concat(chunks, chunklen),

                    // if similar message exists, then skip
                    skipExisting: true
                }, (err, inserted) => {
                    // remove Delivered-To
                    chunks.shift();
                    chunklen -= header.length;

                    if (err) {
                        log.error('SMTP', err);
                    } else if (!inserted) {
                        log.debug('SMTP', 'Message was not inserted');
                    }

                    storeNext();
                });
            };

            storeNext();
        });

        stream.pipe(splitter);
    }
});

module.exports = done => {
    if (!config.smtp.enabled) {
        return setImmediate(() => done(null, false));
    }

    messageHandler = new MessageHandler(db.database);

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
};

function generateReceivedHeader(session, queueId, hostname, recipient) {
    let origin = session.remoteAddress ? '[' + session.remoteAddress + ']' : '';
    let originhost = session.clientHostname && session.clientHostname.charAt(0) !== '[' ? session.clientHostname : false;
    origin = [].concat(origin || []).concat(originhost || []);

    if (origin.length > 1) {
        origin = '(' + origin.join(' ') + ')';
    } else {
        origin = origin.join(' ').trim() || 'localhost';
    }

    let value = '' +
        // from ehlokeyword
        'from' + (session.hostNameAppearsAs ? ' ' + session.hostNameAppearsAs : '') +
        // [1.2.3.4]
        ' ' + origin +
        (originhost ? '\r\n' : '') +

        // by smtphost
        ' by ' + hostname +

        // with ESMTP
        ' with ' + session.transmissionType +
        // id 12345678
        ' id ' + queueId +
        '\r\n' +

        // for <receiver@example.com>
        ' for <' + recipient + '>' +
        // (version=TLSv1/SSLv3 cipher=ECDHE-RSA-AES128-GCM-SHA256)
        (session.tlsOptions ? '\r\n (version=' + session.tlsOptions.version + ' cipher=' + session.tlsOptions.name + ')' : '') +

        ';' +
        '\r\n' +

        // Wed, 03 Aug 2016 11:32:07 +0000
        ' ' + new Date().toUTCString().replace(/GMT/, '+0000');
    return value;
}
