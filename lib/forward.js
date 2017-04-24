'use strict';

const config = require('config');
const db = require('db');
const SeqIndex = require('seq-index');
const seqIndex = new SeqIndex();

module.exports = (options, callback) => {
    if (!config.forwarder.enabled) {
        return callback(null, false);
    }

    let id = options.id || seqIndex.get();
    let seq = 0;
    let documents = [];

    // TODO: create and store message body + headers + dkim hash

    for (let i = 0, len = options.to.length; i < len; i++) {

        let recipient = options.to[i];
        let deliveryZone = config.forwarder.zone || 'default';
        let recipientDomain = recipient.substr(recipient.lastIndexOf('@') + 1).replace(/[\[\]]/g, '');

        seq++;
        let date = new Date();
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

    db.forwarder.collection(config.forwarder.collection).insertMany(documents, {
        w: 1,
        ordered: false
    }, err => {
        if (err) {
            return callback(err);
        }
        callback(null, true);
    });
};
