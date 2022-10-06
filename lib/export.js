'use strict';

const { Transform } = require('stream');

const msgpack = require('msgpack5')();

const MAGIC = Buffer.from([0x09, 0x06, 0x82]);

const TYPE_HEADER = 0x01;
const TYPE_CONTENT = 0x02;

const STATE_MAGIC = 0x03;
const STATE_LEN = 0x04;
const STATE_VAL = 0x05;

class ExportStream extends Transform {
    constructor(meta) {
        super({
            readableObjectMode: false,
            writableObjectMode: true
        });

        this.headerSent = false;
        this.meta = meta || {};
    }

    sendHeader() {
        if (this.headerSent) {
            return;
        }

        this.headerSent = true;

        // magic
        this.push(MAGIC);

        this.writeRecord(
            TYPE_HEADER,
            Object.assign(this.meta, {
                created: new Date()
            })
        );
    }

    writeRecord(recordType, recordData) {
        let recordBuf = Buffer.allocUnsafe(1);
        recordBuf.writeUInt8(recordType, 0);

        let content = msgpack.encode([recordType, recordData]);
        let contentLen = Buffer.allocUnsafe(4);
        contentLen.writeUInt32LE(content.length, 0);

        this.push(Buffer.concat([contentLen, content]));
    }

    _transform(data, encoding, done) {
        this.sendHeader();

        try {
            this.writeRecord(TYPE_CONTENT, data);
        } catch (err) {
            return done(err);
        }

        done();
    }

    _flush(done) {
        done();
    }
}

class ImportStream extends Transform {
    constructor() {
        super({
            readableObjectMode: true,
            writableObjectMode: false
        });

        this.buffer = [];

        this.expectedRecordLength = 0;
        this.expectedRecordLength = false;

        this.curReadState = STATE_MAGIC;
    }

    readMagick(data) {
        if (this.curReadState !== STATE_MAGIC) {
            return data;
        }

        let removeSuffix = 0;
        for (let i = 0; i < data.length; i++) {
            this.buffer.push(data[i]);
            removeSuffix++;
            if (this.buffer.length === 3) {
                if (Buffer.compare(Buffer.from(this.buffer), MAGIC) === 0) {
                    // seems like a correct file
                    this.buffer = []; // reset buffer
                    this.curReadState = STATE_LEN;
                    break;
                } else {
                    let error = new Error('Invalid content sequence');
                    error.code = 'INVALID_SEQUENCE';
                    throw error;
                }
            }
        }

        if (removeSuffix) {
            return data.slice(removeSuffix);
        }

        return data;
    }

    async readRecords(data) {
        let pos = 0;
        while (pos < data.length) {
            switch (this.curReadState) {
                case STATE_LEN: {
                    let c = data[pos++];
                    if (this.buffer.length < 4) {
                        this.buffer.push(c);
                    }
                    if (this.buffer.length === 4) {
                        this.expectedRecordLength = Buffer.from(this.buffer).readUInt32LE(0);
                        this.buffer = false;
                        this.curReadState = STATE_VAL;
                    }
                    break;
                }

                case STATE_VAL: {
                    let buffered = this.buffer ? this.buffer.length : 0;
                    if (pos + (this.expectedRecordLength - buffered) <= data.length) {
                        // entire chunk available
                        let slice = data.subarray(pos, pos + (this.expectedRecordLength - buffered));
                        pos += slice.length;

                        let value = this.buffer ? Buffer.concat([this.buffer, slice]) : slice;

                        let [recordType, recordData] = msgpack.decode(value);
                        switch (recordType) {
                            case TYPE_HEADER:
                                this.emit('header', recordData);
                                break;

                            case TYPE_CONTENT:
                                if (recordData) {
                                    this.push(recordData);
                                }
                                break;
                        }

                        this.buffer = [];
                        this.curReadState = STATE_LEN;
                    } else if (pos < data.length) {
                        let slice = data.subarray(pos);
                        pos += slice.length;
                        this.buffer = this.buffer ? Buffer.concat([this.buffer, slice]) : slice;
                    }
                    break;
                }
            }
        }
    }

    _transform(data, encoding, done) {
        try {
            data = this.readMagick(data);
        } catch (err) {
            if (err) {
                return done(err);
            }
        }

        this.readRecords(data)
            .then(() => done())
            .catch(err => done(err));
    }

    _flush(done) {
        done();
    }
}

module.exports = { ExportStream, ImportStream };
