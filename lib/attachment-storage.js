'use strict';

const ObjectID = require('mongodb').ObjectID;
const crypto = require('crypto');
const GridFSBucket = require('mongodb').GridFSBucket;
let cryptoAsync;
try {
    cryptoAsync = require('@ronomon/crypto-async'); // eslint-disable-line global-require
} catch (E) {
    // ignore
}

class AttachmentStorage {
    constructor(options) {
        this.bucketName = options.bucket || 'attachments';
        this.gridfs = options.gridfs;
        this.gridstore = new GridFSBucket(this.gridfs, {
            bucketName: this.bucketName
        });
    }

    get(attachmentId, callback) {
        this.gridfs.collection('attachments.files').findOne({
            _id: attachmentId
        }, (err, attachmentData) => {
            if (err) {
                return callback(err);
            }
            if (!attachmentData) {
                return callback(new Error('This attachment does not exist'));
            }

            return callback(null, {
                contentType: attachmentData.contentType,
                transferEncoding: attachmentData.metadata.transferEncoding,
                metadata: attachmentData.metadata
            });
        });
    }

    create(attachment, callback) {
        this.calculateHash(attachment.body, (err, hash) => {
            if (err) {
                return callback(err);
            }

            this.gridfs.collection(this.bucketName + '.files').findOneAndUpdate({
                'metadata.h': hash
            }, {
                $inc: {
                    'metadata.c': 1,
                    'metadata.m': attachment.magic
                }
            }, {
                returnOriginal: false
            }, (err, result) => {
                if (err) {
                    return callback(err);
                }

                if (result && result.value) {
                    return callback(null, result.value._id);
                }

                let returned = false;

                let id = new ObjectID();
                let metadata = {
                    h: hash,
                    m: attachment.magic,
                    c: 1,
                    transferEncoding: attachment.transferEncoding
                };
                Object.keys(attachment.metadata || {}).forEach(key => {
                    if (!(key in attachment.metadata)) {
                        metadata[key] = attachment.metadata[key];
                    }
                });

                let store = this.gridstore.openUploadStreamWithId(id, null, {
                    contentType: attachment.contentType,
                    metadata
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

                store.end(attachment.body);
            });
        });
    }

    createReadStream(id) {
        return this.gridstore.openDownloadStream(id);
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
        // update attachments
        this.gridfs.collection(this.bucketName + '.files').updateMany(
            {
                _id: {
                    $in: ids
                }
            },
            {
                $inc: {
                    'metadata.c': count,
                    'metadata.m': magic
                }
            },
            {
                multi: true,
                w: 1
            },
            callback
        );
    }

    delete(id, magic, callback) {
        this.gridfs.collection(this.bucketName + '.files').findOneAndUpdate({
            _id: id
        }, {
            $inc: {
                'metadata.c': -1,
                'metadata.m': -magic
            }
        }, {
            returnOriginal: false
        }, (err, result) => {
            if (err) {
                return callback(err);
            }

            if (!result || !result.value) {
                return callback(null, false);
            }

            if (result.value.metadata.c === 0 && result.value.metadata.m === 0) {
                return this.gridstore.delete(id, err => {
                    if (err) {
                        return callback(err);
                    }
                    callback(null, 1);
                });
            }

            return callback(null, 0);
        });
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
