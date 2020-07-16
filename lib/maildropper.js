'use strict';

const SeqIndex = require('seq-index');
const RelaxedBody = require('nodemailer/lib/dkim/relaxed-body');
const MessageSplitter = require('./message-splitter');
const seqIndex = new SeqIndex();
const GridFSBucket = require('mongodb').GridFSBucket;
const uuid = require('uuid');
const os = require('os');
const hostname = os.hostname().toLowerCase();
const addressparser = require('nodemailer/lib/addressparser');
const punycode = require('punycode');
const crypto = require('crypto');
const tools = require('./tools');

class Maildropper {
    constructor(options) {
        this.options = options || {};
        this.db = options.db;
        this.zone = options.zone;
        this.collection = options.collection;
        this.gfs = options.gfs;

        this.gridstore =
            options.gridstore ||
            new GridFSBucket(this.db.senderDb, {
                bucketName: this.gfs
            });
    }

    checkLoop(envelope, deliveries) {
        if (envelope.reason !== 'forward') {
            return false;
        }

        if (envelope.headers.get('Received').length >= 30) {
            envelope.looped = true;
            return true;
        }

        if (!this.options.loopSecret) {
            return false;
        }

        const loopKey = 'X-WildDuck-Seen';
        const algo = 'sha256';
        const secret = this.options.loopSecret;

        const targetStr = JSON.stringify(deliveries);

        const loopFields = envelope.headers.getDecoded(loopKey);

        // check existing loop headers (max 100 to avoid checking too many hashes)
        for (let i = 0, len = Math.min(loopFields.length, 100); i < len; i++) {
            let field = (loopFields[i].value || '').toLowerCase().trim();
            let salt = field.substr(0, 12);
            let hash = field.substr(12);
            let hmac = crypto.createHmac(algo, secret);
            hmac.update(salt);
            hmac.update(targetStr);
            let result = hmac.digest('hex');
            if (result.toLowerCase() === hash) {
                // Loop detected!
                envelope.looped = true;
                return true;
            }
        }

        const salt = crypto.randomBytes(6).toString('hex').toLowerCase();
        const loopHeader = salt + crypto.createHmac(algo, secret).update(salt).update(targetStr).digest('hex').toLocaleLowerCase();
        envelope.headers.add(loopKey, loopHeader);

        return false;
    }

    push(options, callback) {
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

        if (options.parentId) {
            envelope.parentId = options.parentId;
        }

        if (options.reason) {
            envelope.reason = options.reason;
        }

        let deliveries = [];

        if (options.targets) {
            options.targets.forEach(target => {
                switch (target.type) {
                    case 'mail':
                        deliveries.push({
                            to: target.value,
                            forwardedFor: target.recipient
                        });
                        break;

                    case 'relay':
                        {
                            let recipients = new Set([].concat(options.to || []).concat(target.recipient || []));
                            recipients.forEach(to => {
                                let relayData = target.value;
                                if (typeof relayData === 'string') {
                                    relayData = tools.getRelayData(relayData);
                                }
                                deliveries.push({
                                    to,
                                    mx: relayData.mx,
                                    mxPort: relayData.mxPort,
                                    mxAuth: relayData.mxAuth,
                                    mxSecure: relayData.mxSecure,
                                    skipSRS: true,
                                    forwardedFor: target.recipient
                                });
                            });
                        }
                        break;

                    case 'http':
                        {
                            let recipients = new Set([].concat(options.to || []).concat(target.recipient || []));
                            recipients.forEach(to => {
                                deliveries.push({
                                    to,
                                    http: true,
                                    targetUrl: target.value,
                                    skipSRS: true,
                                    forwardedFor: target.recipient
                                });
                            });
                        }
                        break;
                }
            });
        }

        if (!deliveries.length) {
            deliveries = envelope.to.map(to => ({
                to
            }));
        }

        if (!deliveries.length) {
            let err = new Error('No valid recipients');
            err.code = 'ENORECIPIENTS';
            setImmediate(() => callback(err));
            return false;
        }

        let messageSplitter = new MessageSplitter();
        let dkimStream = new RelaxedBody(envelope.dkim);

        messageSplitter.once('headers', headers => {
            envelope.headers = headers;
            this.updateHeaders(envelope, options);
        });

        dkimStream.on('hash', bodyHash => {
            // store relaxed body hash for signing
            envelope.dkim.bodyHash = bodyHash;
            envelope.bodySize = dkimStream.byteLength;
        });

        messageSplitter.once('error', err => dkimStream.emit('error', err));

        this.store(id, dkimStream, err => {
            if (err) {
                return callback(err);
            }

            if (this.checkLoop(envelope, deliveries)) {
                // looped message
                let err = new Error('Message loop detected');
                err.code = 'ELOOP';
                return this.removeMessage(id, () => callback(err));
            }

            envelope.headers = envelope.headers.getList();
            this.setMeta(id, envelope, err => {
                if (err) {
                    return this.removeMessage(id, () => callback(err));
                }

                let date = new Date();

                for (let i = 0, len = deliveries.length; i < len; i++) {
                    let recipient = deliveries[i];

                    let deliveryZone = options.zone || this.zone || 'default';
                    let recipientDomain = recipient.to.substr(recipient.to.lastIndexOf('@') + 1).replace(/[[\]]/g, '');

                    seq++;
                    let deliverySeq = (seq < 0x100 ? '0' : '') + (seq < 0x10 ? '0' : '') + seq.toString(16);
                    let delivery = {
                        id,
                        seq: deliverySeq,

                        // Actual delivery data
                        domain: recipientDomain,
                        sendingZone: deliveryZone,

                        assigned: 'no',

                        // actual recipient address
                        recipient: recipient.to,

                        locked: false,
                        lockTime: 0,

                        // earliest time to attempt delivery, defaults to now
                        queued: options.sendTime || date,

                        // queued date might change but created should not
                        created: date
                    };

                    if (recipient.http) {
                        delivery.http = recipient.http;
                        delivery.targetUrl = recipient.targetUrl;
                    }

                    ['mx', 'mxPort', 'mxAuth', 'mxSecure'].forEach(key => {
                        if (recipient[key]) {
                            delivery[key] = recipient[key];
                        }
                    });

                    if (recipient.skipSRS) {
                        delivery.skipSRS = true;
                    }

                    documents.push(delivery);
                }

                this.db.senderDb.collection(this.collection).insertMany(
                    documents,
                    {
                        w: 1,
                        ordered: false
                    },
                    err => {
                        if (err) {
                            return callback(err);
                        }

                        callback(null, envelope);
                    }
                );
            });
        });
        messageSplitter.pipe(dkimStream);
        return messageSplitter;
    }

    convertAddresses(addresses, withNames, addressList) {
        addressList = addressList || new Map();

        this.flatten(addresses || []).forEach(address => {
            if (address.address) {
                let normalized = this.normalizeAddress(address, withNames);
                let key = typeof normalized === 'string' ? normalized : normalized.address;
                addressList.set(key, normalized);
            } else if (address.group) {
                this.convertAddresses(address.group, withNames, addressList);
            }
        });

        return addressList;
    }

    parseAddressList(headers, key, withNames) {
        return this.parseAddressses(
            headers.getDecoded(key).map(header => header.value),
            withNames
        );
    }

    parseAddressses(headerList, withNames) {
        let map = this.convertAddresses(
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

    normalizeDomain(domain) {
        domain = domain.toLowerCase().trim();
        try {
            domain = punycode.toASCII(domain);
        } catch (E) {
            // ignore
        }
        return domain;
    }

    // helper function to flatten arrays
    flatten(arr) {
        let flat = [].concat(...arr);
        return flat.some(Array.isArray) ? this.flatten(flat) : flat;
    }

    normalizeAddress(address, withNames) {
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
        let addr = user.trim() + '@' + this.normalizeDomain(domain);

        if (withNames) {
            return {
                name: address.name || '',
                address: addr
            };
        }

        return addr;
    }

    updateHeaders(envelope, options) {
        let updateDate = options && options.updateDate;
        // Fetch sender and receiver addresses
        envelope.parsedEnvelope = {
            from: this.parseAddressList(envelope.headers, 'from').shift() || false,
            to: this.parseAddressList(envelope.headers, 'to'),
            cc: this.parseAddressList(envelope.headers, 'cc'),
            bcc: this.parseAddressList(envelope.headers, 'bcc'),
            replyTo: this.parseAddressList(envelope.headers, 'reply-to').shift() || false,
            sender: this.parseAddressList(envelope.headers, 'sender').shift() || false
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

        if (updateDate || !date || dateVal.toString() === 'Invalid Date' || dateVal < new Date(1000)) {
            date = new Date().toUTCString().replace(/GMT/, '+0000');
            envelope.headers.remove('date'); // remove old empty or invalid values
            envelope.headers.add('Date', date);
        }

        envelope.date = date;

        // Remove BCC if present
        envelope.headers.remove('bcc');
    }

    store(id, stream, callback) {
        let returned = false;
        let store = this.gridstore.openUploadStream('message ' + id, {
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
                this.removeMessage(id, () => callback(err));
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

    removeMessage(id, callback) {
        this.gridstore.unlink('message ' + id, callback);
    }

    setMeta(id, data, callback) {
        this.db.senderDb.collection(this.gfs + '.files').findOneAndUpdate(
            {
                filename: 'message ' + id
            },
            {
                $set: {
                    'metadata.data': data
                }
            },
            {},
            err => {
                if (err) {
                    return callback(err);
                }
                return callback();
            }
        );
    }
}

module.exports = Maildropper;
