'use strict';

const config = require('config');
const db = require('./db');
const SeqIndex = require('seq-index');
const DkimStream = require('./dkim-stream');
const MessageSplitter = require('./message-splitter');
const seqIndex = new SeqIndex();
const GridFs = require('grid-fs');

let gridstore;

module.exports = (options, callback) => {
    if (!config.sender.enabled) {
        return callback(null, false);
    }

    let id = options.id || seqIndex.get();
    let seq = 0;
    let documents = [];

    let envelope = {
        id,

        from: options.from,
        to: Array.isArray(options.to) ? options.to : [].concat(options.to || []),

        interface: options.interface || 'maildrop',
        transtype: 'API',
        time: Date.now(),

        dkim: {
            hashAlgo: 'sha256'
        }
    };

    if (!envelope.to.length) {
        return callback(null, false);
    }

    let messageSplitter = new MessageSplitter();
    let dkimStream = new DkimStream();

    messageSplitter.once('headers', headers => {
        envelope.headers = headers.getList();
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

        setMeta(id, envelope, err => {
            if (err) {
                return removeMessage(id, () => callback(err));
            }

            let date = new Date();

            for (let i = 0, len = envelope.to.length; i < len; i++) {

                let recipient = envelope.to[i];
                let deliveryZone = options.zone || config.sender.zone || 'default';
                let recipientDomain = recipient.substr(recipient.lastIndexOf('@') + 1).replace(/[\[\]]/g, '');

                seq++;
                let deliverySeq = (seq < 0x100 ? '0' : '') + (seq < 0x10 ? '0' : '') + seq.toString(16);
                let delivery = {
                    id,
                    seq: deliverySeq,

                    // Actual delivery data
                    domain: recipientDomain,
                    sendingZone: deliveryZone,

                    // actual recipient address
                    recipient,

                    locked: false,
                    lockTime: 0,

                    // earliest time to attempt delivery, defaults to now
                    queued: date,

                    // queued date might change but created should not
                    created: date
                };

                documents.push(delivery);
            }

            db.senderDb.collection(config.sender.collection).
            insertMany(documents, {
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
    gridstore = gridstore || new GridFs(db.senderDb, config.sender.gfs);

    let returned = false;
    let store = gridstore.createWriteStream('message ' + id, {
        fsync: true,
        content_type: 'message/rfc822',
        metadata: {
            created: new Date()
        }
    });

    stream.once('error', err => {
        if (returned) {
            return;
        }
        returned = true;

        store.once('close', () => {
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

    store.on('close', () => {
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
