'use strict';

// Simple LMTP server that accepts all messages for valid recipients

const config = require('wild-config');
const log = require('npmlog');
const SMTPServer = require('smtp-server').SMTPServer;
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
const db = require('./lib/db');
const forward = require('./lib/forward');
const autoreply = require('./lib/autoreply');
const certs = require('./lib/certs').get('lmtp');

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
    banner: config.lmtp.banner || 'Welcome to Wild Duck Mail Server',

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

        db.users.collection('addresses').findOne({
            addrview: recipient.substr(0, recipient.indexOf('@')).replace(/\./g, '') + recipient.substr(recipient.indexOf('@'))
        }, (err, address) => {
            if (err) {
                log.error('LMTP', err);
                return callback(new Error('Database error'));
            }
            if (!address) {
                return callback(new Error('Unknown recipient'));
            }

            db.users.collection('users').findOne({
                _id: address.user
            }, {
                fields: {
                    name: true,
                    forwards: true,
                    forward: true,
                    targetUrl: true,
                    autoreply: true,
                    encryptMessages: true,
                    pubKey: true
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
            let sender = tools.normalizeAddress((session.envelope.mailFrom && session.envelope.mailFrom.address) || '');
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
                    //+ 'Received: ' + generateReceivedHeader(session, queueId, os.hostname().toLowerCase(), recipient) + '\r\n'
                );

                chunks.unshift(header);
                chunklen += header.length;

                let raw = Buffer.concat(chunks, chunklen);

                let prepared = messageHandler.prepareMessage({
                    raw
                });
                let maildata = messageHandler.indexer.getMaildata(prepared.id, prepared.mimeTree);

                // default flags are empty
                let flags = [];

                // default mailbox target is INBOX
                let mailboxQueryKey = 'path';
                let mailboxQueryValue = 'INBOX';

                db.database.collection('filters').find({ user: user._id }).sort({ _id: 1 }).toArray((err, filters) => {
                    if (err) {
                        // ignore, as filtering is not so important
                    }
                    // append generic spam header check to the filters
                    filters = (filters || []).concat(
                        spamHeader
                            ? {
                                id: 'SPAM',
                                query: {
                                    headers: {
                                        [spamHeader]: 'Yes'
                                    }
                                },
                                action: {
                                    // only applies if any other filter does not already mark message as spam or ham
                                    spam: true
                                }
                            }
                            : []
                    );

                    let forwardTargets = new Set();
                    let forwardTargetUrls = new Set();
                    let matchingFilters = [];
                    let filterActions = new Map();

                    filters
                        // apply all filters to the message
                        .map(filter => checkFilter(filter, prepared, maildata))
                        // remove all unmatched filters
                        .filter(filter => filter)
                        // apply filter actions
                        .forEach(filter => {
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

                                    if (key === 'targetUrl') {
                                        forwardTargetUrls.add(filter.action[key]);
                                        return;
                                    }

                                    // if a previous filter already has set a value then do not touch it
                                    if (!filterActions.has(key)) {
                                        filterActions.set(key, filter.action[key]);
                                    }
                                });
                            }
                        });

                    let forwardMessage = done => {
                        if (user.forward && !filterActions.get('delete')) {
                            // forward to default recipient only if the message is not deleted
                            forwardTargets.add(user.forward);
                        }

                        if (user.targetUrl && !filterActions.get('delete')) {
                            // forward to default URL only if the message is not deleted
                            forwardTargetUrls.add(user.targetUrl);
                        }

                        // never forward messages marked as spam
                        if ((!forwardTargets.size && !forwardTargetUrls.size) || filterActions.get('spam')) {
                            return setImmediate(done);
                        }

                        // check limiting counters
                        messageHandler.counters.ttlcounter(
                            'wdf:' + user._id.toString(),
                            forwardTargets.size + forwardTargetUrls.size,
                            user.forwards,
                            (err, result) => {
                                if (err) {
                                    // failed checks
                                    log.error('LMTP', 'FRWRDFAIL key=%s error=%s', 'wdf:' + user._id.toString(), err.message);
                                } else if (!result.success) {
                                    log.silly('LMTP', 'FRWRDFAIL key=%s error=%s', 'wdf:' + user._id.toString(), 'Precondition failed');
                                    return done();
                                }

                                forward(
                                    {
                                        user,
                                        sender,
                                        recipient,

                                        forward: forwardTargets.size ? Array.from(forwardTargets) : false,
                                        targetUrl: forwardTargetUrls.size ? Array.from(forwardTargetUrls) : false,

                                        chunks
                                    },
                                    done
                                );
                            }
                        );
                    };

                    let sendAutoreply = done => {
                        // never reply to messages marked as spam
                        if (!sender || !user.autoreply || filterActions.get('spam')) {
                            return setImmediate(done);
                        }

                        autoreply(
                            {
                                user,
                                sender,
                                recipient,
                                chunks,
                                messageHandler
                            },
                            done
                        );
                    };

                    forwardMessage((err, id) => {
                        if (err) {
                            log.error(
                                'LMTP',
                                '%s FRWRDFAIL from=%s to=%s target=%s error=%s',
                                prepared.id.toString(),
                                sender,
                                recipient,
                                Array.from(forwardTargets).concat(forwardTargetUrls).join(','),
                                err.message
                            );
                        } else if (id) {
                            log.silly(
                                'LMTP',
                                '%s FRWRDOK id=%s from=%s to=%s target=%s',
                                prepared.id.toString(),
                                id,
                                sender,
                                recipient,
                                Array.from(forwardTargets).concat(forwardTargetUrls).join(',')
                            );
                        }

                        sendAutoreply((err, id) => {
                            if (err) {
                                log.error('LMTP', '%s AUTOREPLYFAIL from=%s to=%s error=%s', prepared.id.toString(), '<>', sender, err.message);
                            } else if (id) {
                                log.silly('LMTP', '%s AUTOREPLYOK id=%s from=%s to=%s', prepared.id.toString(), id, '<>', sender);
                            }

                            if (filterActions.get('delete')) {
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
                                user: (user && user._id) || user,
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

                            messageHandler.encryptMessage(user.encryptMessages ? user.pubKey : false, raw, (err, encrypted) => {
                                if (!err && encrypted) {
                                    messageOptions.prepared = messageHandler.prepareMessage({
                                        raw: encrypted
                                    });
                                    messageOptions.maildata = messageHandler.indexer.getMaildata(prepared.id, prepared.mimeTree);
                                }

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
                            });
                        });
                    });
                });
            };

            storeNext();
        });
    }
};

if (certs) {
    serverOptions.key = certs.key;
    if (certs.ca) {
        serverOptions.ca = certs.ca;
    }
    serverOptions.cert = certs.cert;
}

const server = new SMTPServer(serverOptions);

module.exports = done => {
    if (!config.lmtp.enabled) {
        return setImmediate(() => done(null, false));
    }

    messageHandler = new MessageHandler({ database: db.database, gridfs: db.gridfs, users: db.users, redis: db.redis });

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

    if (typeof query.ha === 'boolean') {
        let hasAttachments = maildata.attachments && maildata.attachments.length;
        // false ha means no attachmens
        if (hasAttachments && !query.ha) {
            return false;
        }
        // true ha means attachmens must exist
        if (!hasAttachments && query.ha) {
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

    if (query.text && maildata.text.toLowerCase().replace(/\s+/g, ' ').indexOf(query.text.toLowerCase()) < 0) {
        // message plaintext does not match the text field value
        return false;
    }

    log.silly('Filter', 'Filter %s matched message %s', filter.id, prepared.id);

    // we reached the end of the filter, so this means we have a match
    return filter;
}
