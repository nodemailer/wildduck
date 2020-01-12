'use strict';

const Transform = require('stream').Transform;

class Newlines extends Transform {
    constructor(options) {
        super(options);
    }

    _transform(chunk, encoding, done) {
        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        let curStart = 0;
        let len = 0;
        for (let i = 0; i < chunk.length; i++) {
            if (chunk[i] === 0x0d) {
                // emit current chunk
                if (len > 0) {
                    this.push(chunk.slice(curStart, curStart + len));
                }
                len = 0;
                // skip current byte
                curStart = i + 1;
            } else {
                len++;
            }
        }

        if (len) {
            this.push(chunk.slice(curStart, curStart + len));
        }

        done();
    }
}

module.exports = Newlines;
