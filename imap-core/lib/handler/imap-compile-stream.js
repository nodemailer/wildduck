/* eslint no-console: 0, new-cap: 0 */

'use strict';

let imapFormalSyntax = require('./imap-formal-syntax');
let streams = require('stream');
let PassThrough = streams.PassThrough;
let LengthLimiter = require('../length-limiter');

/**
 * Compiles an input object into a streamed IMAP response
 */
module.exports = function (response, isLogging) {
    let output = new PassThrough();

    let resp = (response.tag || '') + (response.command ? ' ' + response.command : '');
    let lr = resp; // this value is going to store last known `resp` state for later usage

    let val, lastType;

    let waiting = false;
    let queue = [];
    let ended = false;

    let emit = function (stream, expectedLength, startFrom, maxLength) {
        expectedLength = expectedLength || 0;
        startFrom = startFrom || 0;
        maxLength = maxLength || 0;

        if (resp.length) {
            queue.push(Buffer.from(resp, 'binary'));
            lr = resp;
            resp = '';
        }

        if (stream) {
            queue.push({
                type: 'stream',
                stream,
                expectedLength,
                startFrom,
                maxLength
            });
        }

        if (waiting) {
            return;
        }

        if (!queue.length) {
            if (ended) {
                output.end();
            }
            return;
        }

        let value = queue.shift();
        if (value.type === 'stream') {
            if (!value.expectedLength) {
                return emit();
            }
            waiting = true;
            let expectedLength = value.maxLength ? Math.min(value.expectedLength, value.startFrom + value.maxLength) : value.expectedLength;
            let startFrom = value.startFrom;

            let limiter = new LengthLimiter(expectedLength, ' ', startFrom);

            value.stream.pipe(limiter).pipe(output, {
                end: false
            });

            // pass errors to output
            value.stream.on('error', err => {
                output.emit('error', err);
            });

            limiter.on('end', () => {
                waiting = false;
                return emit();
            });
        } else if (Buffer.isBuffer(value)) {
            output.write(value);
            return emit();
        } else {
            if (typeof value === 'number') {
                value = value.toString();
            } else if (typeof value !== 'string') {
                value = (value || '').toString();
            }
            output.write(Buffer.from(value, 'binary'));
            return emit();
        }
    };

    let walk = function (node, callback) {
        if (lastType === 'LITERAL' || (['(', '<', '['].indexOf((resp || lr).substr(-1)) < 0 && (resp || lr).length)) {
            resp += ' ';
        }

        if (node && node.buffer && !Buffer.isBuffer(node)) {
            // mongodb binary
            node = node.buffer;
        }

        if (Array.isArray(node)) {
            lastType = 'LIST';
            resp += '(';

            let pos = 0;
            let next = () => {
                if (pos >= node.length) {
                    resp += ')';
                    return setImmediate(callback);
                }
                walk(node[pos++], next);
            };

            return setImmediate(next);
        }

        if (!node && typeof node !== 'string' && typeof node !== 'number') {
            resp += 'NIL';
            return setImmediate(callback);
        }

        if (typeof node === 'string' || Buffer.isBuffer(node)) {
            if (isLogging && node.length > 20) {
                resp += '"(* ' + node.length + 'B string *)"';
            } else {
                resp += JSON.stringify(node.toString('binary'));
            }
            return setImmediate(callback);
        }

        if (typeof node === 'number') {
            resp += Math.round(node) || 0; // Only integers allowed
            return setImmediate(callback);
        }

        lastType = node.type;

        if (isLogging && node.sensitive) {
            resp += '"(* value hidden *)"';
            return setImmediate(callback);
        }

        switch (node.type.toUpperCase()) {
            case 'LITERAL':
                {
                    let nval = node.value;

                    if (typeof nval === 'number') {
                        nval = nval.toString();
                    }

                    let len;

                    if (nval && typeof nval.pipe === 'function') {
                        len = node.expectedLength || 0;
                        if (node.startFrom) {
                            len -= node.startFrom;
                        }
                        if (node.maxLength) {
                            len = Math.min(len, node.maxLength);
                        }
                    } else {
                        len = (nval || '').toString().length;
                    }

                    if (isLogging) {
                        resp += '"(* ' + len + 'B literal *)"';
                    } else {
                        resp += '{' + len + '}\r\n';
                        emit();

                        if (nval && typeof nval.pipe === 'function') {
                            //value is a stream object
                            emit(nval, node.expectedLength, node.startFrom, node.maxLength);
                        } else {
                            resp = (nval || '').toString('binary');
                        }
                    }
                    break;
                }
            case 'STRING':
                if (isLogging && node.value.length > 20) {
                    resp += '"(* ' + node.value.length + 'B string *)"';
                } else {
                    resp += JSON.stringify((node.value || '').toString('binary'));
                }
                break;
            case 'TEXT':
            case 'SEQUENCE':
                resp += (node.value || '').toString('binary');
                break;

            case 'NUMBER':
                resp += (node.value || 0);
                break;

            case 'ATOM':
            case 'SECTION':
                {
                    val = (node.value || '').toString('binary');

                    if (imapFormalSyntax.verify(val.charAt(0) === '\\' ? val.substr(1) : val, imapFormalSyntax['ATOM-CHAR']()) >= 0) {
                        val = JSON.stringify(val);
                    }

                    resp += val;

                    let finalize = () => {
                        if (node.partial) {
                            resp += '<' + node.partial.join('.') + '>';
                        }
                        setImmediate(callback);
                    };

                    if (node.section) {
                        resp += '[';

                        let pos = 0;
                        let next = () => {
                            if (pos >= node.section.length) {
                                resp += ']';
                                return setImmediate(finalize);
                            }
                            walk(node.section[pos++], next);
                        };

                        return setImmediate(next);
                    }

                    return finalize();
                }
        }
        setImmediate(callback);
    };

    let finalize = () => {
        ended = true;
        emit();
    };
    let pos = 0;
    let attribs = [].concat(response.attributes || []);
    let next = () => {
        if (pos >= attribs.length) {
            return setImmediate(finalize);
        }
        walk(attribs[pos++], next);
    };
    setImmediate(next);

    return output;
};

// expose for testing
module.exports.LengthLimiter = LengthLimiter;
