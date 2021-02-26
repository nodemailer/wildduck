'use strict';

const net = require('net');

const parseReceived = headerValue => {
    headerValue = headerValue.trim();

    let state = 'none';

    let values = [];
    let expect = false;
    let quoted = false;
    let escaped = false;
    let curKey;
    let timestamp = '';
    let commentLevel = 0;

    let nextValue = () => {
        curKey = '';
        let val = { key: '', value: '', comment: '' };
        values.push(val);
        return val;
    };

    let curValue = nextValue();

    for (let i = 0; i < headerValue.length; i++) {
        let c = headerValue.charAt(i);

        if (state === 'timestamp') {
            timestamp += c;
            continue;
        }

        if (escaped) {
            curValue[curKey] += c;
            escaped = false;
            continue;
        }

        if (quoted) {
            if (c === quoted) {
                quoted = false;
                state = 'none';
                continue;
            }
            curValue[curKey] += c;
            continue;
        }

        if (expect) {
            if (c === expect) {
                if (commentLevel) {
                    commentLevel--;
                    if (commentLevel) {
                        // still in nested comment
                        curValue[curKey] += c;
                        continue;
                    }
                }
                expect = false;
                state = 'none';
                curValue = nextValue();
                continue;
            }
            if (c === '(') {
                commentLevel++;
            }
            curValue[curKey] += c;
            continue;
        }

        switch (c) {
            case ' ':
            case '\t':
            case '\n':
            case '\r':
                state = 'none';
                break;
            case '"':
            case "'":
                // start quoting
                quoted = c;
                break;
            case '(':
                // start comment block
                expect = ')';
                commentLevel++;
                curKey = 'comment';
                break;
            case ';':
                state = 'timestamp';
                break;
            case '\\':
                escaped = true;
                break;
            default:
                if (state === 'none') {
                    state = 'val';
                    switch (curKey) {
                        case '':
                            curKey = 'key';
                            curValue[curKey] += c;
                            break;
                        case 'key':
                            curKey = 'value';
                            curValue[curKey] += c;
                            break;
                        case 'value':
                        case 'comment':
                            curValue = nextValue();
                            curKey = 'key';
                            curValue[curKey] += c;
                            break;
                    }
                } else {
                    if (curKey === 'comment' && c === '(') {
                        commentLevel++;
                    }
                    curValue[curKey] += c;
                }
        }
    }

    timestamp = timestamp.split(';').shift().trim();

    let result = {};

    // join non key values into strings
    for (let i = values.length - 1; i > 1; i--) {
        let val = values[i];
        let prev = values[i - 1];
        let key = val.key.toLowerCase();
        if (!['from', 'by', 'with', 'id', 'for', 'envelope-from', ''].includes(key) && prev.key) {
            prev.value = [prev.value || []]
                .concat(val.key || [])
                .concat(val.value || [])
                .join(' ');
            prev.comment = [prev.comment || []].concat(val.comment || []).join(' ');
            values.splice(i, 1);
        }
    }

    for (let val of values) {
        if (val.comment) {
            val.comment = val.comment.replace(/\s+/g, ' ').trim();
        }
        if (val.key) {
            let key = val.key.toLowerCase();
            if (key !== 'from' && !result.tls && /tls|cipher=|Google Transport Security/i.test(val.comment)) {
                result.tls = { value: '' };
                if (val.comment) {
                    result.tls.comment = val.comment;
                }
                val.comment = '';
            }
            result[key] = { value: val.value };
            if (val.comment) {
                result[key].comment = val.comment;
            }
            if (key === 'from' && result[key].comment) {
                let ipmatch = result[key].comment.match(/\[([^\s\]]+)\]/);
                if (ipmatch && ipmatch[1] && net.isIP(ipmatch[1])) {
                    result[key].ip = ipmatch[1];
                }
            }
        } else if (!result.tls && /tls|cipher=|Google Transport Security/i.test(val.comment)) {
            result.tls = { value: val.value };
            if (val.comment) {
                result.tls.comment = val.comment;
            }
        }
    }

    let withValue = (result.with && result.with.value) || '';
    if (!result.tls && /SMTPS/.test(withValue)) {
        result.tls = { value: '', comment: withValue };
    }

    if (timestamp) {
        result.timestamp = timestamp;
    }

    result.full = headerValue.replace(/\s+/g, ' ').trim();

    return result;
};

module.exports = parseReceived;
