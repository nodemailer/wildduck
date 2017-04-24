'use strict';

// Simple LMTP server that accepts all messages for valid recipients

const config = require('config');
const log = require('npmlog');
const SMTPServer = require('smtp-server').SMTPServer;
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
const db = require('./lib/db');
const forward = require('./lib/forward');
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
            let sender = tools.normalizeAddress(session.envelope.mailFrom && session.envelope.mailFrom.address || '');
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

                let raw = Buffer.concat(chunks, chunklen);
                let prepared = messageHandler.prepareMessage({
                    raw
                });
                let maildata = messageHandler.indexer.processContent(prepared.id, prepared.mimeTree);

                // default flags are empty
                let flags = [];

                // default mailbox target is INBOX
                let mailboxQueryKey = 'path';
                let mailboxQueryValue = 'INBOX';

                let filters = (user.filters || []).concat(spamHeader ? {
                    id: 'wdspam',
                    query: {
                        headers: {
                            [spamHeader]: 'Yes'
                        }
                    },
                    action: {
                        // only applies if any other filter does not already mark message as spam or ham
                        spam: true
                    }
                } : []);

                let forwardTargets = new Set();
                if (user.forward) {
                    // forward all messages
                    forwardTargets.add(user.forward);
                }

                let matchingFilters = [];
                let filterActions = new Map();

                filters.
                // apply all filters to the message
                map(filter => checkFilter(filter, prepared, maildata)).
                // remove all unmatched filers
                filter(filter => filter).
                // apply filter actions
                forEach(filter => {
                    matchingFilters.push(filter.id);

                    // apply matching filter
                    if (!filterActions) {
                        filterActions = filter.action;
                    } else {
                        Object.keys(filter.action).forEach(key => {
                            if (key === 'forward') {
                                forwardTargets.add(filter.action[key]);
                                return;
                            }
                            // if a previous filter already has set a value then do not touch it
                            if (!filterActions.has(key)) {
                                filterActions.set(key, filter.action[key]);
                            }
                        });
                    }
                });

                if (forwardTargets.size) {
                    // messages needs to be forwarded, so store it to outbound queue
                    forward({
                        user,
                        sender,
                        recipient,
                        forward: Array.from(forwardTargets),
                        raw
                    }, () => false);
                }

                if (filterActions.has('delete') && filterActions.get('delete')) {
                    // nothing to do with the message, just continue
                    responses.push({
                        user,
                        response: 'Message dropped by policy as ' + prepared.id.toString()
                    });
                    prepared = false;
                    maildata = false;
                    return storeNext();
                }

                // apply filter results to the message
                filterActions.forEach((value, key) => {
                    switch (key) {
                        case 'spam':
                            if (value > 0) {
                                // positive value is spam
                                mailboxQueryKey = 'specialUse';
                                mailboxQueryValue = '\\Junk';
                            }
                            break;
                        case 'seen':
                            if (value) {
                                flags.push('\\Seen');
                            }
                            break;
                        case 'flag':
                            if (value) {
                                flags.push('\\Flagged');
                            }
                            break;
                        case 'mailbox':
                            if (value) {
                                // positive value is spam
                                mailboxQueryKey = 'mailbox';
                                mailboxQueryValue = value;
                            }
                            break;
                    }
                });

                let messageOptions = {
                    user: user && user._id || user,
                    [mailboxQueryKey]: mailboxQueryValue,

                    prepared,
                    maildata,

                    meta: {
                        source: 'LMTP',
                        from: sender,
                        to: recipient,
                        origin: session.remoteAddress,
                        originhost: session.clientHostname,
                        transhost: session.hostNameAppearsAs,
                        transtype: session.transmissionType,
                        time: Date.now()
                    },

                    filters: matchingFilters,

                    date: false,
                    flags,

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

function checkFilter(filter, prepared, maildata) {
    if (!filter || !filter.query) {
        return false;
    }

    let query = filter.query;

    // prepare filter data
    let headerFilters = new Map();
    if (query.headers) {
        Object.keys(query.headers).forEach(key => {
            headerFilters.set(key, (query.headers[key] || '').toString().toLowerCase());
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
            return false;
        }
    }

    if (query.ha) {
        let hasAttachments = maildata.attachments && maildata.attachments.length;
        // negative ha means no attachmens
        if (hasAttachments && query.ha < 0) {
            return false;
        }
        // positive ha means attachmens must exist
        if (!hasAttachments && query.ha > 0) {
            return false;
        }
    }

    if (query.size) {
        let messageSize = prepared.size;
        let filterSize = Math.abs(query.size);
        // negative value means "less than", positive means "more than"
        if (query.size < 0 && messageSize > filterSize) {
            return false;
        }
        if (query.size > 0 && messageSize < filterSize) {
            return false;
        }
    }

    if (query.text && maildata.text.toLowerCase().indexOf(query.text.toLowerCase()) < 0) {
        // message plaintext does not match the text field value
        return false;
    }

    log.silly('Filter', 'Filter %s matched message %s', filter.id, prepared.id);

    // we reached the end of the filter, so this means we have a match
    return filter;
}
