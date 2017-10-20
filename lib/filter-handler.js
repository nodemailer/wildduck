'use strict';

const log = require('npmlog');
const ObjectID = require('mongodb').ObjectID;
const db = require('./db');
const forward = require('./forward');
const autoreply = require('./autoreply');

const defaultSpamHeaderKeys = [
    {
        key: 'X-Spam-Status',
        value: '^yes',
        target: '\\Junk'
    },

    {
        key: 'X-Rspamd-Spam',
        value: '^yes',
        target: '\\Junk'
    },
    {
        key: 'X-Haraka-Virus',
        value: '.',
        target: '\\Junk'
    }
];

class FilterHandler {
    constructor(options) {
        this.database = options.database;
        this.users = options.users || options.database;
        this.redis = options.redis;
        this.messageHandler = options.messageHandler;

        this.spamChecks = options.spamChecks || prepareSpamChecks(defaultSpamHeaderKeys);
        this.spamHeaderKeys = options.spamHeaderKeys || this.spamChecks.map(check => check.key);
    }

    getUserData(address, callback) {
        let query = {};
        if (!address) {
            return callback(null, false);
        }
        if (typeof address === 'object' && address._id) {
            return callback(null, address);
        }

        let collection;

        if (typeof address === 'object' && typeof address.getTimestamp === 'function') {
            query._id = address;
            collection = 'users';
        } else if (/^[a-f0-9]{24}$/.test(address)) {
            query._id = new ObjectID(address);
            collection = 'users';
        } else if (typeof address !== 'string') {
            return callback(null, false);
        } else if (address.indexOf('@') >= 0) {
            query.addrview = address.substr(0, address.indexOf('@')).replace(/\./g, '') + address.substr(address.indexOf('@'));
            collection = 'addresses';
        } else {
            query.unameview = address.replace(/\./g, '');
            collection = 'users';
        }

        let fields = {
            name: true,
            forwards: true,
            forward: true,
            targetUrl: true,
            autoreply: true,
            encryptMessages: true,
            pubKey: true
        };

        if (collection === 'users') {
            return db.users.collection('users').findOne(
                query,
                {
                    fields
                },
                callback
            );
        }

        return db.users.collection('addresses').findOne(query, (err, addressData) => {
            if (err) {
                return callback(err);
            }
            if (!addressData) {
                return callback(null, false);
            }
            return db.users.collection('users').findOne(
                {
                    _id: addressData.user
                },
                {
                    fields
                },
                callback
            );
        });
    }

    process(options, callback) {
        this.getUserData(options.user || options.recipient, (err, userData) => {
            if (err) {
                return callback(err);
            }
            if (!userData) {
                return callback(null, false);
            }

            this.storeMessage(userData, options, callback);
        });
    }

    storeMessage(userData, options, callback) {
        let sender = options.sender || '';
        let recipient = options.recipient || userData.address;

        // create Delivered-To and Return-Path headers
        let extraHeader = Buffer.from(['Delivered-To: ' + recipient, 'Return-Path: <' + sender + '>'].join('\r\n') + '\r\n');

        let chunks = options.chunks;
        let chunklen = options.chunklen;

        if (!chunks && options.raw) {
            chunks = [options.raw];
            chunklen = options.raw.length;
        }

        let prepared;

        if (options.mimeTree) {
            if (options.mimeTree && options.mimeTree.header) {
                // remove old headers
                if (/^Delivered-To/.test(options.mimeTree.header[0])) {
                    options.mimeTree.header.shift();
                }
                if (/^Return-Path/.test(options.mimeTree.header[0])) {
                    options.mimeTree.header.shift();
                }
            }
            prepared = this.messageHandler.prepareMessage({
                mimeTree: options.mimeTree,
                indexedHeaders: this.spamHeaderKeys
            });
        } else {
            let raw = Buffer.concat(chunks, chunklen);
            prepared = this.messageHandler.prepareMessage({
                raw,
                indexedHeaders: this.spamHeaderKeys
            });
        }

        prepared.mimeTree.header.unshift('Return-Path: <' + sender + '>');
        prepared.mimeTree.header.unshift('Delivered-To: ' + recipient);

        prepared.mimeTree.parsedHeader['return-path'] = '<' + sender + '>';
        prepared.mimeTree.parsedHeader['delivered-to'] = '<' + recipient + '>';

        prepared.size = this.messageHandler.indexer.getSize(prepared.mimeTree);

        let maildata = options.maildata || this.messageHandler.indexer.getMaildata(prepared.mimeTree);

        // default flags are empty
        let flags = [];

        // default mailbox target is INBOX
        let mailboxQueryKey = 'path';
        let mailboxQueryValue = 'INBOX';

        db.database
            .collection('filters')
            .find({
                user: userData._id
            })
            .sort({
                _id: 1
            })
            .toArray((err, filters) => {
                if (err) {
                    // ignore, as filtering is not so important
                }

                filters = (filters || []).concat(
                    this.spamChecks.map((check, i) => ({
                        id: 'SPAM#' + (i + 1),
                        query: {
                            headers: {
                                [check.key]: check.value
                            }
                        },
                        action: {
                            // only applies if any other filter does not already mark message as spam or ham
                            spam: true
                        }
                    }))
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
                    if (userData.forward && !filterActions.get('delete')) {
                        // forward to default recipient only if the message is not deleted
                        forwardTargets.add(userData.forward);
                    }

                    if (userData.targetUrl && !filterActions.get('delete')) {
                        // forward to default URL only if the message is not deleted
                        forwardTargetUrls.add(userData.targetUrl);
                    }

                    // never forward messages marked as spam
                    if ((!forwardTargets.size && !forwardTargetUrls.size) || filterActions.get('spam')) {
                        return setImmediate(done);
                    }

                    // check limiting counters
                    this.messageHandler.counters.ttlcounter(
                        'wdf:' + userData._id.toString(),
                        forwardTargets.size + forwardTargetUrls.size,
                        userData.forwards,
                        false,
                        (err, result) => {
                            if (err) {
                                // failed checks
                                log.error('LMTP', 'FRWRDFAIL key=%s error=%s', 'wdf:' + userData._id.toString(), err.message);
                            } else if (!result.success) {
                                log.silly('LMTP', 'FRWRDFAIL key=%s error=%s', 'wdf:' + userData._id.toString(), 'Precondition failed');
                                return done();
                            }

                            forward(
                                {
                                    parentId: prepared.id,
                                    userData,
                                    sender,
                                    recipient,

                                    forward: forwardTargets.size ? Array.from(forwardTargets) : false,
                                    targetUrl: forwardTargetUrls.size ? Array.from(forwardTargetUrls) : false,

                                    chunks,
                                    chunklen
                                },
                                done
                            );
                        }
                    );
                };

                let sendAutoreply = done => {
                    // never reply to messages marked as spam
                    if (!sender || !userData.autoreply || filterActions.get('spam')) {
                        return setImmediate(done);
                    }

                    autoreply(
                        {
                            parentId: prepared.id,
                            userData,
                            sender,
                            recipient,
                            chunks,
                            chunklen,
                            messageHandler: this.messageHandler
                        },
                        done
                    );
                };

                let outbound = [];

                forwardMessage((err, id) => {
                    if (err) {
                        log.error(
                            'LMTP',
                            '%s FRWRDFAIL from=%s to=%s target=%s error=%s',
                            prepared.id.toString(),
                            sender,
                            recipient,
                            Array.from(forwardTargets)
                                .concat(forwardTargetUrls)
                                .join(','),
                            err.message
                        );
                    } else if (id) {
                        outbound.push(id);
                        log.silly(
                            'LMTP',
                            '%s FRWRDOK id=%s from=%s to=%s target=%s',
                            prepared.id.toString(),
                            id,
                            sender,
                            recipient,
                            Array.from(forwardTargets)
                                .concat(Array.from(forwardTargetUrls))
                                .join(',')
                        );
                    }

                    sendAutoreply((err, id) => {
                        if (err) {
                            log.error('LMTP', '%s AUTOREPLYFAIL from=%s to=%s error=%s', prepared.id.toString(), '<>', sender, err.message);
                        } else if (id) {
                            outbound.push(id);
                            log.silly('LMTP', '%s AUTOREPLYOK id=%s from=%s to=%s', prepared.id.toString(), id, '<>', sender);
                        }

                        if (filterActions.get('delete')) {
                            // nothing to do with the message, just continue
                            return callback(null, {
                                userData,
                                response: 'Message dropped by policy as ' + prepared.id.toString()
                            });
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

                        let messageOpts = {
                            user: userData._id,
                            [mailboxQueryKey]: mailboxQueryValue,

                            prepared,
                            maildata,

                            meta: options.meta,

                            filters: matchingFilters,

                            date: false,
                            flags,

                            // if similar message exists, then skip
                            skipExisting: true
                        };

                        let received = [].concat((prepared.mimeTree.parsedHeader && prepared.mimeTree.parsedHeader.received) || []);
                        if (received.length) {
                            let receivedData = parseReceived(received[0]);

                            if (receivedData.has('with')) {
                                messageOpts.meta.transtype = receivedData.get('with');
                            }

                            if (receivedData.has('id')) {
                                messageOpts.meta.id = receivedData.get('id');
                            }

                            if (receivedData.has('from')) {
                                messageOpts.meta.origin = receivedData.get('from');
                            }
                        }

                        if (outbound && outbound.length) {
                            messageOpts.outbound = [].concat(outbound || []);
                        }

                        this.messageHandler.encryptMessage(
                            userData.encryptMessages ? userData.pubKey : false,
                            {
                                chunks,
                                chunklen
                            },
                            (err, encrypted) => {
                                if (!err && encrypted) {
                                    messageOpts.prepared = this.messageHandler.prepareMessage({
                                        raw: Buffer.concat([extraHeader, encrypted]),
                                        indexedHeaders: this.spamHeaderKeys
                                    });
                                    messageOpts.maildata = this.messageHandler.indexer.getMaildata(messageOpts.prepared.mimeTree);
                                }

                                this.messageHandler.add(messageOpts, (err, inserted, info) => {
                                    // push to response list
                                    callback(
                                        null,
                                        {
                                            userData,
                                            response: err ? err : 'Message stored as ' + info.id.toString()
                                        },
                                        !encrypted
                                            ? {
                                                mimeTree: messageOpts.prepared.mimeTree,
                                                maildata: messageOpts.maildata
                                            }
                                            : false
                                    );
                                });
                            }
                        );
                    });
                });
            });
    }
}

function checkFilter(filter, prepared, maildata) {
    if (!filter || !filter.query) {
        return false;
    }

    let query = filter.query;

    // prepare filter data
    let headerFilters = new Map();
    if (query.headers) {
        Object.keys(query.headers).forEach(key => {
            let value = query.headers[key];
            if (!value || !value.isRegex) {
                value = (query.headers[key] || '').toString().toLowerCase();
            }
            headerFilters.set(key, value);
        });
    }

    // check headers
    if (headerFilters.size) {
        let headerMatches = new Set();
        for (let j = prepared.headers.length - 1; j >= 0; j--) {
            let header = prepared.headers[j];
            if (headerFilters.has(header.key)) {
                let check = headerFilters.get(header.key);
                if (check && check.isRegex && check.test(header.value)) {
                    headerMatches.add(header.key);
                } else if (header.value.indexOf(headerFilters.get(header.key)) >= 0) {
                    headerMatches.add(header.key);
                }
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

    if (
        query.text &&
        maildata.text
            .toLowerCase()
            .replace(/\s+/g, ' ')
            .indexOf(query.text.toLowerCase()) < 0
    ) {
        // message plaintext does not match the text field value
        return false;
    }

    log.silly('Filter', 'Filter %s matched message %s', filter.id, prepared.id);

    // we reached the end of the filter, so this means we have a match
    return filter;
}

module.exports = FilterHandler;

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

function parseReceived(str) {
    let result = new Map();

    str
        .trim()
        .replace(/[\r\n\s\t]+/g, ' ')
        .trim()
        .replace(/(^|\s+)(from|by|with|id|for)\s+([^\s]+)/gi, (m, p, k, v) => {
            let key = k.toLowerCase();
            let value = v;
            if (!result.has(key)) {
                result.set(key, value);
            }
        });

    let date = str
        .split(';')
        .pop()
        .trim();
    if (date) {
        date = new Date(date);
        if (date.getTime()) {
            result.set('date', date);
        }
    }

    return result;
}
