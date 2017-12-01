'use strict';

// Simple LMTP server that accepts all messages for valid recipients

const config = require('wild-config');
const log = require('npmlog');
const ObjectID = require('mongodb').ObjectID;
const SMTPServer = require('smtp-server').SMTPServer;
const tools = require('./lib/tools');
const MessageHandler = require('./lib/message-handler');
const FilterHandler = require('./lib/filter-handler');
const db = require('./lib/db');
const certs = require('./lib/certs');

let messageHandler;
let filterHandler;
let spamChecks, spamHeaderKeys;

config.on('reload', () => {
    spamChecks = prepareSpamChecks(config.spamHeader);
    spamHeaderKeys = spamChecks.map(check => check.key);

    if (filterHandler) {
        filterHandler.spamChecks = spamChecks;
        filterHandler.spamHeaderKeys = spamHeaderKeys;
    }

    log.info('LMTP', 'Configuration reloaded');
});

const serverOptions = {
    lmtp: true,

    secure: config.lmtp.secure,
    secured: config.lmtp.secured,

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

    name: config.lmtp.name || false,

    // not required but nice-to-have
    banner: config.lmtp.banner || 'Welcome to Wild Duck Mail Server',

    disabledCommands: ['AUTH'].concat(config.lmtp.disableSTARTTLS ? 'STARTTLS' : []),

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

        let resolveAddress = next => {
            db.users.collection('addresses').findOne(
                {
                    addrview: recipient.substr(0, recipient.indexOf('@')).replace(/\./g, '') + recipient.substr(recipient.indexOf('@'))
                },
                (err, address) => {
                    if (err) {
                        log.error('LMTP', err);
                        return callback(new Error('Database error'));
                    }
                    if (address) {
                        return next(null, address);
                    }

                    db.users.collection('addresses').findOne(
                        {
                            addrview: '*' + recipient.substr(recipient.indexOf('@'))
                        },
                        (err, address) => {
                            if (err) {
                                log.error('LMTP', err);
                                return callback(new Error('Database error'));
                            }

                            if (!address) {
                                return callback(new Error('Unknown recipient'));
                            }

                            next(null, address);
                        }
                    );
                }
            );
        };

        resolveAddress((err, address) => {
            if (err) {
                log.error('LMTP', err);
                return callback(new Error('Database error'));
            }
            if (!address) {
                return callback(new Error('Unknown recipient'));
            }

            db.users.collection('users').findOne(
                {
                    _id: address.user
                },
                {
                    fields: {
                        name: true,
                        forwards: true,
                        forward: true,
                        targetUrl: true,
                        autoreply: true,
                        encryptMessages: true,
                        encryptForwarded: true,
                        pubKey: true
                    }
                },
                (err, user) => {
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
                }
            );
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
            let sender = tools.normalizeAddress((session.envelope.mailFrom && session.envelope.mailFrom.address) || '');
            let responses = [];
            let users = session.users;
            let stored = 0;

            let transactionId = new ObjectID();

            let prepared = false;

            let storeNext = () => {
                if (stored >= users.length) {
                    return callback(null, responses.map(r => r.response));
                }

                let rcptData = users[stored++];
                let recipient = rcptData.recipient;
                let userData = rcptData.user;

                let response = responses.filter(r => r.userData === userData);
                if (response.length) {
                    responses.push(response[0]);
                    return storeNext();
                }

                filterHandler.process(
                    {
                        mimeTree: prepared && prepared.mimeTree,
                        maildata: prepared && prepared.maildata,
                        user: userData,
                        sender,
                        recipient,
                        chunks,
                        chunklen,
                        meta: {
                            transactionId,
                            source: 'MX',
                            from: sender,
                            to: [recipient],
                            origin: session.remoteAddress,
                            originhost: session.clientHostname,
                            transhost: session.hostNameAppearsAs,
                            transtype: session.transmissionType,
                            time: new Date()
                        }
                    },
                    (err, response, preparedResponse) => {
                        if (err) {
                            // ???
                        }

                        if (response) {
                            responses.push(response);
                        }

                        if (!prepared && preparedResponse) {
                            prepared = preparedResponse;
                        }

                        setImmediate(storeNext);
                    }
                );
            };

            storeNext();
        });
    }
};

certs.loadTLSOptions(serverOptions, 'lmtp');

const server = new SMTPServer(serverOptions);

certs.registerReload(server, 'lmtp');

module.exports = done => {
    if (!config.lmtp.enabled) {
        return setImmediate(() => done(null, false));
    }

    spamChecks = prepareSpamChecks(config.spamHeader);
    spamHeaderKeys = spamChecks.map(check => check.key);

    messageHandler = new MessageHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments
    });

    filterHandler = new FilterHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        messageHandler,
        spamHeaderKeys,
        spamChecks
    });

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

function prepareSpamChecks(spamHeader) {
    return (Array.isArray(spamHeader) ? spamHeader : [].concat(spamHeader || []))
        .map(header => {
            if (!header) {
                return false;
            }

            // If only a single header key is specified, check if it matches Yes
            if (typeof header === 'string') {
                header = {
                    key: header,
                    value: '^yes',
                    target: '\\Junk'
                };
            }

            let key = (header.key || '')
                .toString()
                .trim()
                .toLowerCase();
            let value = (header.value || '').toString().trim();
            try {
                if (value) {
                    value = new RegExp(value, 'i');
                    value.isRegex = true;
                }
            } catch (E) {
                value = false;
                log.error('LMTP', 'Failed loading spam header rule %s. %s', JSON.stringify(header.value), E.message);
            }
            if (!key || !value) {
                return false;
            }
            let target = (header.target || '').toString().trim() || 'INBOX';
            return {
                key,
                value,
                target
            };
        })
        .filter(check => check);
}
