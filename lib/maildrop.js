'use strict';

const config = require('config');
const db = require('./db');
const SeqIndex = require('seq-index');
const DkimStream = require('./dkim-stream');
const MessageSplitter = require('./message-splitter');
const seqIndex = new SeqIndex();
const GridFSBucket = require('mongodb').GridFSBucket;
const uuid = require('uuid');
const os = require('os');
const hostname = os.hostname().toLowerCase();
const addressparser = require('addressparser');
const punycode = require('punycode');

let gridstore;

function convertAddresses(addresses, withNames, addressList) {
    addressList = addressList || new Map();

    flatten(addresses || []).forEach(address => {
        if (address.address) {
            let normalized = normalizeAddress(address, withNames);
            let key = typeof normalized === 'string' ? normalized : normalized.address;
            addressList.set(key, normalized);
        } else if (address.group) {
            convertAddresses(address.group, withNames, addressList);
        }
    });

    return addressList;
}

function parseAddressList(headers, key, withNames) {
    return parseAddressses(headers.getDecoded(key).map(header => header.value), withNames);
}

function parseAddressses(headerList, withNames) {
    let map = convertAddresses(
        headerList.map(address => {
            if (typeof address === 'string') {
                address = addressparser(address);
            }
            return address;
        }),
        withNames
    );
    return Array.from(map).map(entry => entry[1]);
}

function normalizeDomain(domain) {
    domain = domain.toLowerCase().trim();
    try {
        domain = punycode.toASCII(domain);
    } catch (E) {
        // ignore
    }
    return domain;
}

// helper function to flatten arrays
function flatten(arr) {
    let flat = [].concat(...arr);
    return flat.some(Array.isArray) ? flatten(flat) : flat;
}

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
    let addr = user.trim() + '@' + normalizeDomain(domain);

    if (withNames) {
        return {
            name: address.name || '',
            address: addr
        };
    }

    return addr;
}

function updateHeaders(envelope) {
    // Fetch sender and receiver addresses
    envelope.parsedEnvelope = {
        from: parseAddressList(envelope.headers, 'from').shift() || false,
        to: parseAddressList(envelope.headers, 'to'),
        cc: parseAddressList(envelope.headers, 'cc'),
        bcc: parseAddressList(envelope.headers, 'bcc'),
        replyTo: parseAddressList(envelope.headers, 'reply-to').shift() || false,
        sender: parseAddressList(envelope.headers, 'sender').shift() || false
    };

    // Check Message-ID: value. Add if missing
    let mId = envelope.headers.getFirst('message-id');
    if (!mId) {
        mId = '<' + uuid.v4() + '@' + (envelope.from.substr(envelope.from.lastIndexOf('@') + 1) || hostname) + '>';

        envelope.headers.remove('message-id'); // in case there's an empty value
        envelope.headers.add('Message-ID', mId);
    }
    envelope.messageId = mId;

    // Check Date: value. Add if missing or invalid or future date
    let date = envelope.headers.getFirst('date');
    let dateVal = new Date(date);
    if (!date || dateVal.toString() === 'Invalid Date' || dateVal < new Date(1000)) {
        date = new Date().toUTCString().replace(/GMT/, '+0000');
        envelope.headers.remove('date'); // remove old empty or invalid values
        envelope.headers.add('Date', date);
    }

    envelope.date = date;

    // Remove BCC if present
    envelope.headers.remove('bcc');
}

module.exports = (options, callback) => {
    if (!config.sender.enabled) {
        return callback(null, false);
    }

    let id = options.id || seqIndex.get();
    let seq = 0;
    let documents = [];

    let envelope = {
        id,

        from: options.from || '',
        to: Array.isArray(options.to) ? options.to : [].concat(options.to || []),

        interface: options.interface || 'maildrop',
        transtype: 'API',
        time: Date.now(),

        dkim: {
            hashAlgo: 'sha256'
        }
    };

    let deliveries = [];

    if (options.targeUrl) {
        let targetUrls = [].concat(options.targeUrl || []).map(targetUrl => ({
            to: options.to,
            http: true,
            targetUrl
        }));
        deliveries = deliveries.concat(targetUrls);
    }

    if (options.forward) {
        let forwards = [].concat(options.forward || []).map(forward => ({
            to: forward
        }));
        deliveries = deliveries.concat(forwards);
    }

    if (!deliveries.length) {
        deliveries = envelope.to.map(to => ({
            to
        }));
    }

    if (!deliveries.length) {
        return callback(null, false);
    }

    let messageSplitter = new MessageSplitter();
    let dkimStream = new DkimStream();

    messageSplitter.once('headers', headers => {
        envelope.headers = headers;
        updateHeaders(envelope);
    });

    dkimStream.on('hash', bodyHash => {
        // store relaxed body hash for signing
        envelope.dkim.bodyHash = bodyHash;
        envelope.bodySize = dkimStream.byteLength;
    });

    messageSplitter.once('error', err => dkimStream.emit('error', err));

    store(id, dkimStream, err => {
        if (err) {
            return callback(err);
        }

        envelope.headers = envelope.headers.getList();
        setMeta(id, envelope, err => {
            if (err) {
                return removeMessage(id, () => callback(err));
            }

            let date = new Date();

            for (let i = 0, len = deliveries.length; i < len; i++) {
                let recipient = deliveries[i];
                let deliveryZone = options.zone || config.sender.zone || 'default';
                let recipientDomain = recipient.to.substr(recipient.to.lastIndexOf('@') + 1).replace(/[[\]]/g, '');

                seq++;
                let deliverySeq = (seq < 0x100 ? '0' : '') + (seq < 0x10 ? '0' : '') + seq.toString(16);
                let delivery = {
                    id,
                    seq: deliverySeq,

                    // Actual delivery data
                    domain: recipientDomain,
                    sendingZone: deliveryZone,

                    // actual recipient address
                    recipient: recipient.to,
                    http: recipient.http,
                    targetUrl: recipient.targetUrl,

                    locked: false,
                    lockTime: 0,

                    // earliest time to attempt delivery, defaults to now
                    queued: date,

                    // queued date might change but created should not
                    created: date
                };

                documents.push(delivery);
            }

            db.senderDb.collection(config.sender.collection).insertMany(documents, {
                w: 1,
                ordered: false
            }, err => {
                if (err) {
                    return callback(err);
                }

                callback(null, id);
            });
        });
    });

    messageSplitter.pipe(dkimStream);
    return messageSplitter;
};

function store(id, stream, callback) {
    gridstore =
        gridstore ||
        new GridFSBucket(db.senderDb, {
            bucketName: config.sender.gfs
        });

    let returned = false;
    let store = gridstore.openUploadStream('message ' + id, {
        fsync: true,
        contentType: 'message/rfc822',
        metadata: {
            created: new Date()
        }
    });

    stream.once('error', err => {
        if (returned) {
            return;
        }
        returned = true;

        store.once('finish', () => {
            removeMessage(id, () => callback(err));
        });

        store.end();
    });

    store.once('error', err => {
        if (returned) {
            return;
        }
        returned = true;
        callback(err);
    });

    store.once('finish', () => {
        if (returned) {
            return;
        }
        returned = true;

        return callback(null, id);
    });

    stream.pipe(store);
}

function removeMessage(id, callback) {
    gridstore.unlink('message ' + id, callback);
}

function setMeta(id, data, callback) {
    db.senderDb.collection(config.sender.gfs + '.files').findAndModify({
        filename: 'message ' + id
    }, false, {
        $set: {
            'metadata.data': data
        }
    }, {}, err => {
        if (err) {
            return callback(err);
        }
        return callback();
    });
}
