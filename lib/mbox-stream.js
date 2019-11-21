'use strict';

const Transform = require('stream').Transform;

class MboxStream extends Transform {
    constructor(options) {
        super();
        this.options = options || {};

        this.from = options.from || 'MAILER-DAEMON';
        let date;
        try {
            date = (options.date && new Date(options.date)) || new Date();
        } catch (err) {
            date = new Date();
        }
        if (date.toString() === 'Invalid Date') {
            date = new Date();
        }
        this.date = date;
        this.state = 'line_start';
        this.expecting = [];
        this.headerSent = false;
        this.pending = [];

        this.lastByte = false;
    }

    _transform(chunk, encoding, done) {
        if (!this.headerSent) {
            let value = Buffer.from(`From ${this.from} ${asctime(this.date)}\n`);
            if (value.length) {
                this.push(value);
                this.lastByte = value[value.lenght - 1];
            }

            this.headerSent = true;
        }

        if (typeof chunk === 'string') {
            chunk = Buffer.from(chunk, encoding);
        }

        let startPos = 0;
        let len = 0;
        for (let i = 0; i < chunk.length; i++) {
            let c = chunk[i];

            switch (this.state) {
                case 'line_start':
                    {
                        if (this.expecting.includes(c)) {
                            if (c === 0x3e /* > */) {
                                if (!this.pending.length) {
                                    // flush current
                                    if (len) {
                                        let value = chunk.slice(startPos, startPos + len);
                                        if (value.length) {
                                            this.push(value);
                                            this.lastByte = value[value.lenght - 1];
                                        }
                                        len = 0;
                                    }
                                }

                                // still wait for beginning
                                this.expecting = [0x3e /* > */, 0x46 /* F */];
                                this.pending.push(c);
                            } else if (c === 0x46 /* F */) {
                                if (!this.pending.length) {
                                    // flush current
                                    if (len) {
                                        let value = chunk.slice(startPos, startPos + len);
                                        if (value.length) {
                                            this.push(value);
                                            this.lastByte = value[value.lenght - 1];
                                        }
                                        len = 0;
                                    }
                                }
                                this.expecting = [0x72 /* r */];
                                this.pending.push(c);
                            } else if (c === 0x72 /* r */) {
                                this.expecting = [0x6f /* o */];
                                this.pending.push(c);
                            } else if (c === 0x6f /* o */) {
                                this.expecting = [0x6d /* m */];
                                this.pending.push(c);
                            } else if (c === 0x6d /* m */) {
                                this.expecting = [0x20 /* " " */];
                                this.pending.push(c);
                            } else if (c === 0x20 /* " " */) {
                                // should  escape
                                this.expecting = [];

                                this.pending.push(c);
                                // add padding char
                                this.pending.unshift(0x3e);

                                let value = Buffer.from(this.pending);
                                if (value.length) {
                                    this.push(value);
                                    this.lastByte = value[value.lenght - 1];
                                }

                                this.pending = [];
                                this.state = 'normal';
                                startPos = i;
                                len = 1;
                            }
                        } else {
                            if (this.pending.length) {
                                let value = Buffer.from(this.pending);
                                if (value.length) {
                                    this.push(value);
                                    this.lastByte = value[value.lenght - 1];
                                }

                                this.pending = [];
                                startPos = i;
                                len = 0;
                            }

                            if (c === 0x0a) {
                                this.state = 'line_start';
                                this.expecting = [0x3e /* > */, 0x46 /* F */];
                            } else if (this.expecting.length) {
                                this.expecting = [];
                                this.state = 'normal';
                            }

                            len++;
                        }
                    }
                    break;
                default:
                    if (c === 0x0a) {
                        this.state = 'line_start';
                        this.expecting = [0x3e /* > */, 0x46 /* F */];
                    }
                    len++;
                    break;
            }
        }

        if (!this.pending.length) {
            // flush
            let value = chunk.slice(startPos, startPos + len);
            if (value.length) {
                this.push(value);
                this.lastByte = value[value.lenght - 1];
            }
        }

        done();
    }

    _flush(done) {
        if (this.pending.length) {
            let value = Buffer.from(this.pending);
            if (value.length) {
                this.push(value);
                this.lastByte = value[value.lenght - 1];
            }
            this.pending = [];
        }
        if (this.lastByte === 0x0a) {
            this.push(Buffer.from('\n'));
        } else {
            this.push(Buffer.from('\n\n'));
        }

        done();
    }
}

// Sat Nov  5 23:27:03 2016
function asctime(date) {
    // 'Tue, 12 Nov 2019 14:19:37 GMT'
    let parts = date.toUTCString().split(/[\s,]+/);

    let res = [];

    // "Sat"
    res.push(parts[0].substr(0, 3));

    // "Nov"
    res.push(parts[2]);

    // " 5"
    let day = parts[1].replace(/^0/, '').trim();
    res.push((day.length < 2 ? ' ' : '') + day);

    // "23:27:03"
    res.push(parts[4]);

    // 2016
    res.push(parts[3]);

    return res.join(' ');
}

module.exports = MboxStream;
