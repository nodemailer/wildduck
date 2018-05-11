'use strict';

const GridstoreStorage = require('./attachments/gridstore-storage.js');
const crypto = require('crypto');

const CHUNK_SIZE = 64 * 1024; // chunk size for calculating hashes

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

    createReadStream(id, attachmentData) {
        return this.storage.createReadStream(id, attachmentData);
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

        let hash = crypto.createHash(algo);

        let chunkPos = 0;
        let nextChunk = () => {
            try {
                if (chunkPos >= input.length) {
                    let result = hash.digest('hex');
                    return callback(null, result);
                }

                if (!chunkPos && CHUNK_SIZE >= input.length) {
                    // fits all
                    hash.update(input);
                } else if (chunkPos + CHUNK_SIZE >= input.length) {
                    // final chunk
                    hash.update(input.slice(chunkPos));
                } else {
                    // middle chunk
                    hash.update(input.slice(chunkPos, chunkPos + CHUNK_SIZE));
                }

                chunkPos += CHUNK_SIZE;
                return setImmediate(nextChunk);
            } catch (E) {
                return callback(E);
            }
        };

        setImmediate(nextChunk);
    }
}

module.exports = AttachmentStorage;
