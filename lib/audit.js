'use strict';

const ObjectID = require('mongodb').ObjectID;
const GridFSBucket = require('mongodb').GridFSBucket;

class AuditHandler {
    constructor(options) {
        this.options = options || {};
        this.gridfs = options.gridfs || options.database;

        this.bucketName = this.options.bucket || 'audit';
        this.gridstore = new GridFSBucket(this.gridfs, {
            bucketName: this.bucketName,
            chunkSizeBytes: 255 * 1024,
            writeConcern: { w: this.options.writeConcern || 1 }
        });
    }

    async store(audit, message, metadata) {
        if (!message) {
            throw new Error('Missing message content');
        }

        if (typeof message === 'string') {
            message = Buffer.from(message);
        }

        let id = new ObjectID();

        metadata = metadata || {};
        metadata.audit = metadata.audit || audit;
        metadata.date = metadata.date || new Date();

        return new Promise((resolve, reject) => {
            if (!Buffer.isBuffer(message) && typeof message.pipe !== 'function') {
                return reject(new Error('Invalid message content'));
            }

            let stream = this.gridstore.openUploadStreamWithId(id, null, {
                contentType: 'message/rfc822',
                metadata
            });

            stream.once('finish', () => resolve(id));

            if (Buffer.isBuffer(message)) {
                // store as a buffer
                return stream.end(message);
            }

            message.on('error', err => {
                stream.emit('error', err);
            });

            message.pipe(stream);
        });
    }
}

module.exports = AuditHandler;
