'use strict';

const log = require('npmlog');
const ObjectID = require('mongodb').ObjectID;
const forward = require('./forward');
const autoreply = require('./autoreply');
const Maildropper = require('./maildropper');
const tools = require('./tools');
const consts = require('./consts');

class FilterHandler {
    constructor(options) {
        this.db = options.db;
        this.messageHandler = options.messageHandler;

        this.maildrop = new Maildropper({
            db: this.db,
            zone: options.sender.zone,
            collection: options.sender.collection,
            gfs: options.sender.gfs
        });
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

        if (tools.isId(address)) {
            query._id = new ObjectID(address);
            collection = 'users';
        } else if (typeof address !== 'string') {
            return callback(null, false);
        } else if (address.indexOf('@') >= 0) {
            query.addrview = tools.uview(address);
            collection = 'addresses';
        } else {
            query.unameview = address.replace(/\./g, '');
            collection = 'users';
        }

        let fields = {
            name: true,
            forwards: true,
            targets: true,
            autoreply: true,
            encryptMessages: true,
            encryptForwarded: true,
            pubKey: true,
            spamLevel: true,
            audit: true
        };

        if (collection === 'users') {
            return this.db.users.collection('users').findOne(
                query,
                {
                    projection: fields
                },
                callback
            );
        }

        return this.db.users.collection('addresses').findOne(query, (err, addressData) => {
            if (err) {
                return callback(err);
            }
            if (!addressData || !!addressData.user) {
                return callback(null, false);
            }
            return this.db.users.collection('users').findOne(
                {
                    _id: addressData.user
                },
                {
                    projection: fields
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

        let filterResults = [];

        // create Delivered-To and Return-Path headers
        let extraHeader = Buffer.from(['Delivered-To: ' + recipient, 'Return-Path: <' + sender + '>'].join('\r\n') + '\r\n');

        let chunks = options.chunks;
        let chunklen = options.chunklen;

        if (!chunks && options.raw) {
            chunks = [options.raw];
            chunklen = options.raw.length;
        }

        let getPreparedMessage = next => {
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

                return this.messageHandler.prepareMessage(
                    {
                        mimeTree: options.mimeTree
                    },
                    next
                );
            } else {
                let raw = Buffer.concat(chunks, chunklen);
                return this.messageHandler.prepareMessage(
                    {
                        raw
                    },
                    next
                );
            }
        };

        getPreparedMessage((err, prepared) => {
            if (err) {
                return callback(err);
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

            let meta = options.meta || {};

            let received = [].concat((prepared.mimeTree.parsedHeader && prepared.mimeTree.parsedHeader.received) || []);
            if (received.length) {
                let receivedData = parseReceived(received[0]);

                if (!receivedData.has('id') && received.length > 1) {
                    receivedData = parseReceived(received[1]);
                }

                if (receivedData.has('with')) {
                    meta.transtype = receivedData.get('with');
                }

                if (receivedData.has('id')) {
                    meta.queueId = receivedData.get('id');
                }

                if (receivedData.has('from')) {
                    meta.origin = receivedData.get('from');
                }
            }

            this.db.database
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

                    // remove disabled filters
                    filters = (filters || []).filter(filter => !filter.disabled);

                    let isEncrypted = false;
                    let forwardTargets = new Map();

                    let matchingFilters = [];
                    let filterActions = new Map();

                    filters
                        // apply all filters to the message
                        .map(filter => checkFilter(filter, prepared, maildata))
                        // remove all unmatched filters
                        .filter(filter => filter)
                        // apply filter actions
                        .forEach(filter => {
                            matchingFilters.push(filter.id || filter._id);

                            // apply matching filter
                            Object.keys(filter.action).forEach(key => {
                                if (key === 'targets') {
                                    [].concat(filter.action[key] || []).forEach(target => {
                                        forwardTargets.set(target.value, target);
                                    });
                                    return;
                                }

                                // if a previous filter already has set a value then do not touch it
                                if (!filterActions.has(key)) {
                                    filterActions.set(key, filter.action[key]);
                                }
                            });
                        });

                    if (typeof userData.spamLevel === 'number' && userData.spamLevel >= 0) {
                        let isSpam;

                        if (userData.spamLevel === 0) {
                            // always mark as spam
                            isSpam = true;
                        } else if (userData.spamLevel === 100) {
                            // always mark as ham
                            isSpam = false;
                            filterActions.set('spam', false);
                        } else if (!filterActions.has('spam')) {
                            let spamLevel;
                            switch (meta.spamAction) {
                                case 'reject':
                                    spamLevel = 25;
                                    break;

                                case 'rewrite subject':
                                case 'soft reject':
                                    spamLevel = 50;
                                    break;

                                case 'greylist':
                                case 'add header':
                                    spamLevel = 75;
                                    break;

                                case 'no action':
                                default:
                                    spamLevel = 100;
                                    break;
                            }
                            isSpam = userData.spamLevel >= spamLevel;
                        }

                        if (isSpam && !filterActions.has('spam')) {
                            // only update if spam decision is not yet made
                            filterActions.set('spam', true);
                        }
                    }

                    let encryptMessage = (condition, next) => {
                        if (!condition || isEncrypted) {
                            return next();
                        }
                        this.messageHandler.encryptMessage(
                            userData.pubKey,
                            {
                                chunks,
                                chunklen
                            },
                            (err, encrypted) => {
                                if (err) {
                                    return next();
                                }
                                if (encrypted) {
                                    chunks = [encrypted];
                                    chunklen = encrypted.length;
                                    isEncrypted = true;

                                    return this.messageHandler.prepareMessage(
                                        {
                                            raw: Buffer.concat([extraHeader, encrypted])
                                        },
                                        (err, preparedEncrypted) => {
                                            if (err) {
                                                return callback(err);
                                            }
                                            prepared = preparedEncrypted;
                                            maildata = this.messageHandler.indexer.getMaildata(prepared.mimeTree);
                                            next();
                                        }
                                    );
                                }

                                next();
                            }
                        );
                    };

                    let forwardMessage = done => {
                        if (!filterActions.get('delete')) {
                            // forward to default recipient only if the message is not deleted
                            if (userData.targets && userData.targets.length) {
                                userData.targets.forEach(target => {
                                    forwardTargets.set(target.value, target);
                                });
                            } else if (options.targets && options.targets.length) {
                                // if user had no special targets, then use default ones provided by options
                                options.targets.forEach(target => {
                                    forwardTargets.set(target.value, target);
                                });
                            }
                        }

                        // never forward messages marked as spam
                        if (!forwardTargets.size || filterActions.get('spam')) {
                            return setImmediate(done);
                        }

                        // check limiting counters
                        this.messageHandler.counters.ttlcounter(
                            'wdf:' + userData._id.toString(),
                            forwardTargets.size,
                            userData.forwards || consts.MAX_FORWARDS,
                            false,
                            (err, result) => {
                                if (err) {
                                    // failed checks
                                    log.error('Filter', 'FRWRDFAIL key=%s error=%s', 'wdf:' + userData._id.toString(), err.message);
                                } else if (!result.success) {
                                    log.silly('Filter', 'FRWRDFAIL key=%s error=%s', 'wdf:' + userData._id.toString(), 'Precondition failed');
                                    return done();
                                }

                                encryptMessage(userData.encryptForwarded && userData.pubKey, () => {
                                    forward(
                                        {
                                            db: this.db,
                                            maildrop: this.maildrop,

                                            parentId: prepared.id,
                                            userData,
                                            sender,
                                            recipient,

                                            targets:
                                                (forwardTargets.size &&
                                                    Array.from(forwardTargets).map(row => ({
                                                        type: row[1].type,
                                                        value: row[1].value
                                                    }))) ||
                                                false,

                                            chunks,
                                            chunklen
                                        },
                                        done
                                    );
                                });
                            }
                        );
                    };

                    let sendAutoreply = done => {
                        // never reply to messages marked as spam
                        if (!sender || !userData.autoreply || filterActions.get('spam') || options.disableAutoreply) {
                            return setImmediate(done);
                        }

                        let curtime = new Date();
                        this.db.database.collection('autoreplies').findOne(
                            {
                                user: userData._id
                            },
                            (err, autoreplyData) => {
                                if (err) {
                                    return done(err);
                                }

                                if (!autoreplyData || !autoreplyData.status) {
                                    return done(null, false);
                                }

                                if (autoreplyData.start && autoreplyData.start > curtime) {
                                    return done(null, false);
                                }

                                if (autoreplyData.end && autoreplyData.end < curtime) {
                                    return done(null, false);
                                }

                                autoreply(
                                    {
                                        db: this.db,
                                        maildrop: this.maildrop,

                                        parentId: prepared.id,
                                        userData,
                                        sender,
                                        recipient,
                                        chunks,
                                        chunklen,
                                        messageHandler: this.messageHandler
                                    },
                                    autoreplyData,
                                    done
                                );
                            }
                        );
                    };

                    let outbound = [];

                    forwardMessage((err, id) => {
                        if (err) {
                            log.error(
                                'Filter',
                                '%s FRWRDFAIL from=%s to=%s target=%s error=%s',
                                prepared.id.toString(),
                                sender,
                                recipient,
                                Array.from(forwardTargets)
                                    .map(row => row[0])
                                    .join(','),
                                err.message
                            );
                        } else if (id) {
                            filterResults.push({
                                forward: Array.from(forwardTargets)
                                    .map(row => row[0])
                                    .join(','),
                                'forward-queue-id': id
                            });
                            outbound.push(id);
                            log.silly(
                                'Filter',
                                '%s FRWRDOK id=%s from=%s to=%s target=%s',
                                prepared.id.toString(),
                                id,
                                sender,
                                recipient,
                                Array.from(forwardTargets)
                                    .map(row => row[0])
                                    .join(',')
                            );
                        }

                        sendAutoreply((err, id) => {
                            if (err) {
                                log.error('Filter', '%s AUTOREPLYFAIL from=%s to=%s error=%s', prepared.id.toString(), '<>', sender, err.message);
                            } else if (id) {
                                filterResults.push({ autoreply: sender, 'autoreply-queue-id': id });
                                outbound.push(id);
                                log.silly('Filter', '%s AUTOREPLYOK id=%s from=%s to=%s', prepared.id.toString(), id, '<>', sender);
                            }

                            if (filterActions.get('delete')) {
                                // nothing to do with the message, just continue
                                let err = new Error('Message dropped by policy');
                                err.code = 'DroppedByPolicy';

                                filterResults.push({ delete: true });

                                return callback(null, {
                                    userData,
                                    response: 'Message dropped by policy as ' + prepared.id.toString(),
                                    error: err
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
                                            filterResults.push({ spam: true });
                                        }
                                        break;
                                    case 'seen':
                                        if (value) {
                                            flags.push('\\Seen');
                                            filterResults.push({ seen: true });
                                        }
                                        break;
                                    case 'flag':
                                        if (value) {
                                            flags.push('\\Flagged');
                                            filterResults.push({ flagged: true });
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

                                meta,

                                filters: matchingFilters,

                                date: false,
                                flags
                            };

                            if (outbound && outbound.length) {
                                messageOpts.outbound = [].concat(outbound || []);
                            }

                            if (forwardTargets.size) {
                                messageOpts.forwardTargets = Array.from(forwardTargets).map(row => ({
                                    type: row[1].type,
                                    value: row[1].value
                                }));
                            }

                            encryptMessage(userData.encryptMessages && userData.pubKey, () => {
                                if (isEncrypted) {
                                    // make sure we have the updated message structure values
                                    messageOpts.prepared = prepared;
                                    messageOpts.maildata = maildata;
                                    filterResults.push({ encrypted: true });
                                }

                                this.messageHandler.add(messageOpts, (err, inserted, info) => {
                                    if (info) {
                                        filterResults.push({ mailbox: info.mailbox && info.mailbox.toString(), id: info.id && info.id.toString() });
                                    }

                                    if (matchingFilters && matchingFilters.length) {
                                        filterResults.push({
                                            matchingFilters: matchingFilters.map(id => (id || '').toString())
                                        });
                                    }

                                    // push to response list
                                    callback(
                                        null,
                                        {
                                            userData,
                                            response: err ? err : 'Message stored as ' + info.id.toString(),
                                            filterResults,
                                            error: err
                                        },
                                        (!isEncrypted && {
                                            // reuse parsed values
                                            mimeTree: messageOpts.prepared.mimeTree,
                                            maildata: messageOpts.maildata
                                        }) ||
                                            false
                                    );
                                });
                            });
                        });
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
            let header = key.replace(/[A-Z]+/g, c => '-' + c.toLowerCase());
            let value = query.headers[key];
            if (!value || !value.isRegex) {
                value = (query.headers[key] || '').toString().toLowerCase();
            }
            if (value) {
                if (header === 'list-id' && typeof value === 'string' && value.indexOf('<') >= 0) {
                    // only check actual ID part of the List-ID header
                    let m = value.match(/<([^>]+)/);
                    if (m && m[1] && m[1].trim()) {
                        value = m[1].trim();
                    }
                }

                headerFilters.set(header, value);
            }
        });
    }

    // check headers
    if (headerFilters.size) {
        let headerMatches = new Set();
        for (let j = prepared.headers.length - 1; j >= 0; j--) {
            let header = prepared.headers[j];
            let key = header.key;
            switch (key) {
                case 'cc':
                    if (!headerFilters.get('cc')) {
                        // match cc against to query
                        key = 'to';
                    }
                    break;
            }
            if (headerFilters.has(key)) {
                let check = headerFilters.get(key);
                let value = (header.value || '').toString();

                if (check.isRegex) {
                    if (check.test(value)) {
                        headerMatches.add(key);
                    }
                } else if (value === check || value.indexOf(check) >= 0) {
                    headerMatches.add(key);
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

function parseReceived(str) {
    let result = new Map();

    str.trim()
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
