'use strict';

// Simple LMTP server that accepts all messages for valid recipients

const config = require('config');
const log = require('npmlog');
const SMTPServer = require('smtp-server').SMTPServer;
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
const MessageSplitter = require('./lib/message-splitter');
const db = require('./lib/db');
const fs = require('fs');

let messageHandler;

const serverOptions = {

    lmtp: true,

    // log to console
    logger: {
        info(...args) {
            args.shift();
            log.info('LMTP', ...args);
        },
        debug(...args) {
            args.shift();
            log.silly('LMTP', ...args);
        },
        error(...args) {
            args.shift();
            log.error('LMTP', ...args);
        }
    },

    name: false,

    // not required but nice-to-have
    banner: 'Welcome to Wild Duck Mail Server',

    disabledCommands: ['AUTH'],

    onMailFrom(address, session, callback) {

        // reset session entries
        session.users = [];

        // accept alls sender addresses
        return callback();
    },

    // Validate RCPT TO envelope address. Example allows all addresses that do not start with 'deny'
    // If this method is not set, all addresses are allowed
    onRcptTo(rcpt, session, callback) {
        let originalRecipient = tools.normalizeAddress(rcpt.address);
        let recipient = originalRecipient.replace(/\+[^@]*@/, '@');

        db.database.collection('addresses').findOne({
            address: recipient
        }, (err, address) => {
            if (err) {
                log.error('LMTP', err);
                return callback(new Error('Database error'));
            }
            if (!address) {
                return callback(new Error('Unknown recipient'));
            }

            db.database.collection('users').findOne({
                _id: address.user
            }, (err, user) => {
                if (err) {
                    log.error('LMTP', err);
                    return callback(new Error('Database error'));
                }
                if (!user) {
                    return callback(new Error('Unknown recipient'));
                }

                if (!session.users) {
                    session.users = [];
                }

                session.users.push({
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

        let splitter = new MessageSplitter();

        splitter.on('readable', () => {
            let chunk;
            while ((chunk = splitter.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
        });

        stream.once('error', err => {
            log.error('LMTP', err);
            callback(new Error('Error reading from stream'));
        });

        splitter.once('end', () => {
            chunks.unshift(splitter.rawHeaders);
            chunklen += splitter.rawHeaders.length;

            let isSpam = false;
            let spamHeader = config.spamHeader && config.spamHeader.toLowerCase();

            if (Array.isArray(splitter.headers)) {
                for (let i = splitter.headers.length - 1; i >= 0; i--) {
                    let header = splitter.headers[i];

                    // check if the header is used for detecting spam
                    if (spamHeader === header.key) {
                        let value = header.line.substr(header.line.indexOf(':') + 1).trim();
                        if (/^yes\b/i.test(value)) {
                            isSpam = true;
                        }
                    }
                }
            }

            let responses = [];
            let users = session.users;
            let stored = 0;
            let storeNext = () => {
                if (stored >= users.length) {
                    return callback(null, responses.map(r => r.response));
                }

                let rcptData = users[stored++];
                let recipient = rcptData.recipient;
                let user = rcptData.user;

                let response = responses.filter(r => r.user === user);
                if (response.length) {
                    responses.push(response[0]);
                    return storeNext();
                }

                // create Delivered-To and Received headers
                let header = Buffer.from(
                    'Delivered-To: ' + recipient + '\r\n'
                    //+ 'Received: ' + generateReceivedHeader(session, queueId, os.hostname(), recipient) + '\r\n'
                );

                chunks.unshift(header);
                chunklen += header.length;

                let mailboxQueryKey = 'path';
                let mailboxQueryValue = 'INBOX';

                if (isSpam) {
                    mailboxQueryKey = 'specialUse';
                    mailboxQueryValue = '\\Junk';
                }

                let messageOptions = {
                    user,
                    [mailboxQueryKey]: mailboxQueryValue,

                    meta: {
                        source: 'LMTP',
                        from: tools.normalizeAddress(session.envelope.mailFrom && session.envelope.mailFrom.address || ''),
                        to: recipient,
                        origin: session.remoteAddress,
                        originhost: session.clientHostname,
                        transhost: session.hostNameAppearsAs,
                        transtype: session.transmissionType,
                        time: Date.now()
                    },

                    date: false,
                    flags: false,
                    // if similar message exists, then skip
                    skipExisting: true
                };

                messageOptions.raw = Buffer.concat(chunks, chunklen);

                messageHandler.add(messageOptions, (err, inserted, info) => {

                    // remove Delivered-To
                    chunks.shift();
                    chunklen -= header.length;

                    // push to response list
                    responses.push({
                        user,
                        response: err ? err : 'Message stored as ' + info.id.toString()
                    });

                    storeNext();
                });
            };

            storeNext();
        });

        stream.pipe(splitter);
    }
};

if (config.lmtp.key) {
    serverOptions.key = fs.readFileSync(config.lmtp.key);
}

if (config.lmtp.cert) {
    serverOptions.cert = fs.readFileSync(config.lmtp.cert);
}

const server = new SMTPServer(serverOptions);

module.exports = done => {
    if (!config.lmtp.enabled) {
        return setImmediate(() => done(null, false));
    }

    messageHandler = new MessageHandler(db.database);

    let started = false;

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }
        log.error('LMTP', err);
    });

    server.listen(config.lmtp.port, config.lmtp.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        done(null, server);
    });
};
/*
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
*/
