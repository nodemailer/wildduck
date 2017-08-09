'use strict';

const GridFSBucket = require('mongodb').GridFSBucket;

class GridstoreStorage {
    constructor(options) {
        this.bucketName = (options.options && options.options.bucket) || 'attachments';
        this.gridfs = options.gridfs;
        this.gridstore = new GridFSBucket(this.gridfs, {
            bucketName: this.bucketName
        });
    }

    get(attachmentId, callback) {
        this.gridfs.collection(this.bucketName + '.files').findOne({
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
                length: attachmentData.length,
                count: attachmentData.metadata.c,
                hash: attachmentData._id,
                metadata: attachmentData.metadata
            });
        });
    }

    create(attachment, hash, callback) {
        hash = Buffer.from(hash, 'hex');

        let returned = false;
        let retried = false;

        let id = hash;
        let metadata = {
            m: attachment.magic,
            c: 1,
            transferEncoding: attachment.transferEncoding
        };

        Object.keys(attachment.metadata || {}).forEach(key => {
            if (!(key in attachment.metadata)) {
                metadata[key] = attachment.metadata[key];
            }
        });

        let tryStore = () => {
            this.gridfs.collection(this.bucketName + '.files').findOneAndUpdate({
                _id: hash
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
                    // already exists
                    return callback(null, result.value._id);
                }

                // try to insert it
                let store = this.gridstore.openUploadStreamWithId(id, null, {
                    contentType: attachment.contentType,
                    metadata
                });

                store.once('error', err => {
                    if (returned) {
                        return;
                    }
                    if (err.code === 11000) {
                        // most probably a race condition, try again
                        if (!retried) {
                            retried = true;
                            return setTimeout(tryStore, 10);
                        }
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
        };

        tryStore();
    }

    createReadStream(id) {
        return this.gridstore.openDownloadStream(id);
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

            /*
            // disabled as it is preferred that attachments are not deleted immediately but
            // after a while by a cleanup process. This gives the opportunity to reuse the
            // attachment

            if (result.value.metadata.c === 0 && result.value.metadata.m === 0) {
                return this.gridstore.delete(id, err => {
                    if (err) {
                        return callback(err);
                    }
                    callback(null, 1);
                });
            }
            */

            return callback(null, true);
        });
    }

    update(ids, count, magic, callback) {
        // update attachments
        this.gridfs.collection(this.bucketName + '.files').updateMany(
            {
                _id: Array.isArray(ids)
                    ? {
                        $in: ids
                    }
                    : ids
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

    deleteOrphaned(callback) {
        // NB! scattered query
        let cursor = this.gridfs.collection(this.bucketName + '.files').find({
            'metadata.c': 0,
            'metadata.m': 0
        });

        let deleted = 0;
        let processNext = () => {
            cursor.next((err, attachment) => {
                if (err) {
                    return callback(err);
                }
                if (!attachment) {
                    return cursor.close(() => {
                        // delete all attachments that do not have any active links to message objects
                        callback(null, deleted);
                    });
                }

                if (!attachment || (attachment.metadata && attachment.metadata.c)) {
                    // skip
                    return processNext();
                }

                // delete file entry first
                this.gridfs.collection('attachments.files').deleteOne({
                    _id: attachment._id,
                    // make sure that we do not delete a message that is already re-used
                    'metadata.c': 0,
                    'metadata.m': 0
                }, (err, result) => {
                    if (err || !result.deletedCount) {
                        return processNext();
                    }

                    // delete data chunks
                    this.gridfs.collection('attachments.chunks').deleteMany({
                        files_id: attachment._id
                    }, err => {
                        if (err) {
                            // ignore as we don't really care if we have orphans or not
                        }

                        deleted++;
                        processNext();
                    });
                });
            });
        };

        processNext();
    }
}

module.exports = GridstoreStorage;
