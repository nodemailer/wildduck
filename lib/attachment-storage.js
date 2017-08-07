'use strict';

const GridstoreStorage = require('./attachments/gridstore-storage.js');
const crypto = require('crypto');
let cryptoAsync;
try {
    cryptoAsync = require('@ronomon/crypto-async'); // eslint-disable-line global-require
} catch (E) {
    // ignore
}

class AttachmentStorage {
    constructor(options) {
        this.options = options || {};

        let type = (options.options && options.options.type) || 'gridstore';

        switch (type) {
            case 'gridstore':
            default:
                this.storage = new GridstoreStorage(this.options);
                break;
        }
    }

    get(attachmentId, callback) {
        return this.storage.get(attachmentId, callback);
    }

    create(attachment, callback) {
        this.calculateHash(attachment.body, (err, hash) => {
            if (err) {
                return callback(err);
            }
            return this.storage.create(attachment, hash, callback);
        });
    }

    createReadStream(id) {
        return this.storage.createReadStream(id);
    }

    deleteMany(ids, magic, callback) {
        let pos = 0;
        let deleteNext = () => {
            if (pos >= ids.length) {
                return callback(null, true);
            }
            let id = ids[pos++];
            this.delete(id, magic, deleteNext);
        };
        deleteNext();
    }

    updateMany(ids, count, magic, callback) {
        this.storage.update(ids, count, magic, callback);
    }

    delete(id, magic, callback) {
        this.storage.delete(id, magic, callback);
    }

    deleteOrphaned(callback) {
        this.storage.deleteOrphaned(callback);
    }

    calculateHash(input, callback) {
        let algo = 'sha256';

        if (!cryptoAsync) {
            setImmediate(() => callback(null, crypto.createHash(algo).update(input).digest('hex')));
            return;
        }

        cryptoAsync.hash(algo, input, (err, hash) => {
            if (err) {
                return callback(err);
            }
            return callback(null, hash.toString('hex'));
        });
    }
}

module.exports = AttachmentStorage;
