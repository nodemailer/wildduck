'use strict';

const Transform = require('stream').Transform;
const crypto = require('crypto');

class FileHashCalculatorStream extends Transform {
    constructor(options) {
        super(options);
        this.bodyHash = crypto.createHash('sha256');
        this.hash = null;
    }

    updateHash(chunk) {
        this.bodyHash.update(chunk);
    }

    _transform(chunk, encoding, callback) {
        if (!chunk || !chunk.length) {
            return callback();
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        this.updateHash(chunk);
        this.push(chunk);

        callback();
    }

    _flush(done) {
        this.hash = this.bodyHash.digest('base64');
        done();
    }
}

module.exports = FileHashCalculatorStream;
