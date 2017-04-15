'use strict';

// Simple LMTP server that accepts all messages for valid recipients

const config = require('config');
const log = require('npmlog');
const SMTPServer = require('smtp-server').SMTPServer;
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
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
            }, {
                fields: {
                    filters: true
                }
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
                    user
                });

                callback();
            });
        });
    },

    // Handle message stream
    onData(stream, session, callback) {
        let chunks = [];
        let chunklen = 0;

        stream.on('readable', () => {
            let chunk;
            while ((chunk = stream.read()) !== null) {
                chunks.push(chunk);
                chunklen += chunk.length;
            }
        });

        stream.once('error', err => {
            log.error('LMTP', err);
            callback(new Error('Error reading from stream'));
        });

        stream.once('end', () => {

            let spamHeader = config.spamHeader && config.spamHeader.toLowerCase();

            let isSpam = false;

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

                let prepared = messageHandler.prepareMessage({
                    raw: Buffer.concat(chunks, chunklen)
                });

                let mailboxQueryKey = 'path';
                let mailboxQueryValue = 'INBOX';

                let filters = [
                    // example filter
                    {
                        query: {
                            headers: {
                                from: 'abc',
                                to: 'def',
                                subject: 'ghi'
                            },
                            text: 'jkl',
                            // positive: must have attachments, negative: no attachments
                            ha: 1,
                            // positive: larger than size, netaive: smaller than abs(size)
                            size: 10
                        },
                        action: {
                            // mark message as seen
                            seen: true,
                            // mark message as flagged
                            flag: true,
                            // set mailbox ID
                            mailbox: 'aaaaa',
                            // positive spam, negative ham
                            spam: 1,
                            // if true, delete message
                            delete: false
                        }
                    }
                ].concat(spamHeader ? {
                    query: {
                        headers: {
                            [spamHeader]: 'Yes'
                        }
                    },
                    action: {
                        spam: true
                    }
                } : []);

                let filterResults = checkFilters(prepared, filters);

                // TODO: apply filter result

                // apply filters
                if (spamHeader) {
                    for (let i = prepared.headers.length - 1; i >= 0; i--) {
                        let header = prepared.headers[i];
                        // check if the header is used for detecting spam
                        if (spamHeader === header.key) {
                            if (/^yes\b/i.test(header.value)) {
                                isSpam = true;
                            }
                        }
                    }
                }

                if (isSpam) {
                    mailboxQueryKey = 'specialUse';
                    mailboxQueryValue = '\\Junk';
                }

                let messageOptions = {
                    user: user && user._id || user,
                    [mailboxQueryKey]: mailboxQueryValue,

                    prepared,

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

function checkFilters(prepared, filters) {
    if (!filters || !filters.length) {
        return false;
    }

    for (let i = 0; i < filters.length; i++) {
        let filter = filters[i];

        // prepare filter data
        let headerFilters = new Map();
        if (filter.headers) {
            Object.keys(filter.headers).forEach(key => {
                headerFilters.set(key, (filter.headers[key] || '').toString().toLowerCase());
            });
        }

        // check headers
        if (headerFilters.size) {
            let headerMatches = new Set();
            for (let j = prepared.headers.length - 1; j >= 0; j--) {
                let header = prepared.headers[j];
                if (headerFilters.has(header.key) && header.value.indexOf(headerFilters.get(header.key)) >= 0) {
                    headerMatches.add(header.key);
                }
            }
            if (headerMatches.size < headerFilters.size) {
                // not enough matches
                continue;
            }
        }

        if (filter.ha) {
            // FIXME: there is no prepared.maildata :(
            let hasAttachments = prepared.maildata && prepared.maildata.attachments && prepared.maildata.attachments.length;
            if (hasAttachments && filter.ha < 0) {
                continue;
            }
        }

        if (filter.size) {
            let messageSize = prepared.size;
            let filterSize = Math.abs(filter.size);
            // negative value means "less than", positive means "more than"
            if (filter.size < 0 && messageSize > filterSize) {
                continue;
            }
            if (filter.size > 0 && messageSize < filterSize) {
                continue;
            }
        }

        if (filter.text) {
            // TODO: check against plaintext version of the message
        }

        // we reached the end of the filter, so this means we have a match
        return filter.action;
    }

    return false;
}
