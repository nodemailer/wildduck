'use strict';

const GridFSBucket = require('mongodb').GridFSBucket;
const libbase64 = require('libbase64');
const errors = require('../errors');

// Set to false to disable base64 decoding feature
const FEATURE_DECODE_ATTACHMENTS = true;

class GridstoreStorage {
    constructor(options) {
        this.bucketName = (options.options && options.options.bucket) || 'attachments';
        this.decodeBase64 = (options.options && options.options.decodeBase64) || false;

        this.gridfs = options.gridfs;
        this.gridstore = new GridFSBucket(this.gridfs, {
            bucketName: this.bucketName,
            chunkSizeBytes: 255 * 1024,
            writeConcern: { w: 'majority' }
        });
    }

    get(attachmentId, callback) {
        this.gridfs.collection(this.bucketName + '.files').findOne(
            {
                _id: attachmentId
            },
            (err, attachmentData) => {
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
            }
        );
    }

    create(attachment, hash, callback) {
        hash = Buffer.from(hash, 'hex');
        let returned = false;

        let id = hash;
        let metadata = {
            m: attachment.magic,
            c: 1,
            esize: attachment.body.length,
            transferEncoding: attachment.transferEncoding
        };

        if (isNaN(metadata.m) || typeof metadata.m !== 'number') {
            errors.notify(new Error('Invalid magic "' + metadata.m + '" for ' + id));
        }

        Object.keys(attachment.metadata || {}).forEach(key => {
            if (!(key in attachment.metadata)) {
                metadata[key] = attachment.metadata[key];
            }
        });

        if (FEATURE_DECODE_ATTACHMENTS && attachment.transferEncoding === 'base64' && this.decodeBase64) {
            let lineLen = 0;
            let expectBr = false;
            //find out the length of first line
            for (let i = 0, len = Math.min(1000, attachment.body.length); i < len; i++) {
                let chr = attachment.body[i];
                if (expectBr && chr === 0x0a) {
                    // found line ending
                    break;
                } else if (expectBr) {
                    // unexpected char, do not process
                    lineLen = 0;
                    break;
                } else if (
                    (chr >= 0x30 /*0*/ && chr <= 0x39) /*9*/ ||
                    (chr >= 0x41 /* A */ && chr <= 0x5a) /*Z*/ ||
                    (chr >= 0x61 /* a */ && chr <= 0x7a) /*z*/ ||
                    chr === 0x2b /*+*/ ||
                    chr === 0x2f /*/*/ ||
                    chr === 0x3d /*=*/
                ) {
                    lineLen++;
                } else if (chr === 0x0d) {
                    expectBr = true;
                } else {
                    // unexpected char, do not process
                    lineLen = 0;
                    break;
                }
            }

            if (lineLen && lineLen <= 998) {
                if (attachment.body.length === lineLen && lineLen < 76) {
                    lineLen = 76;
                }

                // check if expected line count matches with attachment line count
                let expectedLineCount = Math.ceil(attachment.body.length / (lineLen + 2));

                // allow 1 line shift
                if (attachment.lineCount >= expectedLineCount - 1 && attachment.lineCount <= expectedLineCount + 1) {
                    metadata.decoded = true;
                    metadata.lineLen = lineLen;
                }
            }
        }

        let tryCount = 0;
        let tryStore = () => {
            if (returned) {
                // might be already finished if retrying after delay
                return;
            }

            this.gridfs.collection(this.bucketName + '.files').findOneAndUpdate(
                {
                    _id: hash
                },
                {
                    $inc: {
                        'metadata.c': 1,
                        'metadata.m': attachment.magic
                    }
                },
                {
                    returnOriginal: false
                },
                (err, result) => {
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
                            if (tryCount++ < 5) {
                                if (/attachments\.chunks /.test(err.message)) {
                                    // partial chunks for a probably deleted message detected, try to clean up
                                    return setTimeout(() => this.cleanupGarbage(id, tryStore), 100 + 200 * Math.random());
                                }
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

                    if (!metadata.decoded) {
                        store.end(attachment.body);
                    } else {
                        let decoder = new libbase64.Decoder();
                        decoder.pipe(store);
                        decoder.once('error', err => {
                            // pass error forward
                            store.emit('error', err);
                        });
                        decoder.end(attachment.body);
                    }
                }
            );
        };

        tryStore();
    }

    createReadStream(id, attachmentData) {
        let stream = this.gridstore.openDownloadStream(id);
        if (attachmentData && attachmentData.metadata.decoded) {
            let encoder = new libbase64.Encoder({
                lineLength: attachmentData.metadata.lineLen
            });

            stream.once('error', err => {
                // pass error forward
                encoder.emit('error', err);
            });
            stream.pipe(encoder);

            return encoder;
        }

        return stream;
    }

    delete(id, magic, callback) {
        if (isNaN(magic) || typeof magic !== 'number') {
            errors.notify(new Error('Invalid magic "' + magic + '" for ' + id));
        }
        this.gridfs.collection(this.bucketName + '.files').findOneAndUpdate(
            {
                _id: id
            },
            {
                $inc: {
                    'metadata.c': -1,
                    'metadata.m': -magic
                }
            },
            {
                returnOriginal: false
            },
            (err, result) => {
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
            }
        );
    }

    update(ids, count, magic, callback) {
        if (isNaN(magic) || typeof magic !== 'number') {
            errors.notify(new Error('Invalid magic "' + magic + '" for ' + ids));
        }
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
                this.gridfs.collection(this.bucketName + '.files').deleteOne(
                    {
                        _id: attachment._id,
                        // make sure that we do not delete a message that is already re-used
                        'metadata.c': 0,
                        'metadata.m': 0
                    },
                    err => {
                        if (err) {
                            return processNext();
                        }

                        // delete data chunks
                        this.gridfs.collection(this.bucketName + '.chunks').deleteMany(
                            {
                                files_id: attachment._id
                            },
                            err => {
                                if (err) {
                                    // ignore as we don't really care if we have orphans or not
                                }

                                deleted++;
                                processNext();
                            }
                        );
                    }
                );
            });
        };

        processNext();
    }

    cleanupGarbage(id, next) {
        this.gridfs.collection(this.bucketName + '.files').findOne(
            {
                _id: id
            },
            (err, file) => {
                if (err) {
                    return next(err);
                }
                if (file) {
                    // attachment entry exists, do nothing
                    return next(null, false);
                }

                // orphaned attachment, delete data chunks
                this.gridfs.collection(this.bucketName + '.chunks').deleteMany(
                    {
                        files_id: id
                    },
                    (err, info) => {
                        if (err) {
                            return next(err);
                        }
                        next(null, info.deletedCount);
                    }
                );
            }
        );
    }
}

module.exports = GridstoreStorage;
