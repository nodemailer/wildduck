'use strict';

const os = require('os');
const punycode = require('punycode');
const libmime = require('libmime');
const consts = require('./consts');
const fs = require('fs');
const he = require('he');
const pathlib = require('path');
const crypto = require('crypto');

let templates = false;

function checkRangeQuery(uids, ne) {
    // check if uids is a straight continous array and if such then return a range query,
    // otherwise retrun a $in query

    if (uids.length === 1) {
        return {
            [!ne ? '$eq' : '$ne']: uids[0]
        };
    }

    for (let i = 1, len = uids.length; i < len; i++) {
        if (uids[i] !== uids[i - 1] + 1) {
            return {
                [!ne ? '$in' : '$nin']: uids
            };
        }
    }

    if (!ne) {
        return {
            $gte: uids[0],
            $lte: uids[uids.length - 1]
        };
    } else {
        return {
            $not: {
                $gte: uids[0],
                $lte: uids[uids.length - 1]
            }
        };
    }
}

function normalizeAddress(address, withNames) {
    if (typeof address === 'string') {
        address = {
            address
        };
    }
    if (!address || !address.address) {
        return '';
    }
    let user = address.address.substr(0, address.address.lastIndexOf('@')).normalize('NFC').toLowerCase().trim();
    let domain = address.address.substr(address.address.lastIndexOf('@') + 1).toLowerCase().trim();
    let encodedDomain = domain;
    try {
        encodedDomain = punycode.toUnicode(domain);
    } catch (E) {
        // ignore
    }

    let addr = user + '@' + encodedDomain;

    if (withNames) {
        return {
            name: address.name || '',
            address: addr
        };
    }

    return addr;
}

// returns a redis config object with a retry strategy
function redisConfig(defaultConfig) {
    let response = {};

    if (typeof defaultConfig === 'string') {
        defaultConfig = {
            url: defaultConfig
        };
    }

    Object.keys(defaultConfig || {}).forEach(key => {
        response[key] = defaultConfig[key];
    });
    if (!response.hasOwnProperty('retry_strategy')) {
        response.retry_strategy = options => {
            if (options.error && options.error.code === 'ECONNREFUSED') {
                // End reconnecting on a specific error and flush all commands with a individual error
                return new Error('The server refused the connection');
            }

            if (options.total_retry_time > 1000 * 60 * 60) {
                // End reconnecting after a specific timeout and flush all commands with a individual error
                return new Error('Retry time exhausted');
            }

            if (options.attempt > 10) {
                // End reconnecting with built in error
                return undefined; // eslint-disable-line no-undefined
            }

            // reconnect after
            return Math.min(options.attempt * 100, 3000);
        };
    }

    return response;
}

function decodeAddresses(addresses) {
    addresses.forEach(address => {
        address.name = (address.name || '').toString();
        if (address.name) {
            try {
                address.name = libmime.decodeWords(address.name);
            } catch (E) {
                //ignore, keep as is
            }
        }
        if (/@xn--/.test(address.address)) {
            address.address =
                address.address.substr(0, address.address.lastIndexOf('@') + 1) +
                punycode.toUnicode(address.address.substr(address.address.lastIndexOf('@') + 1));
        }
        if (address.group) {
            decodeAddresses(address.group);
        }
    });
}

function getMailboxCounter(db, mailbox, type, done) {
    let prefix = type ? type : 'total';
    db.redis.get(prefix + ':' + mailbox.toString(), (err, sum) => {
        if (err) {
            return done(err);
        }

        if (sum !== null) {
            return done(null, Number(sum));
        }

        // calculate sum
        let query = { mailbox };
        if (type) {
            query[type] = true;
        }

        db.database.collection('messages').count(query, (err, sum) => {
            if (err) {
                return done(err);
            }

            // cache calculated sum in redis
            db.redis.multi().set(prefix + ':' + mailbox.toString(), sum).expire(prefix + ':' + mailbox.toString(), consts.MAILBOX_COUNTER_TTL).exec(() => {
                done(null, sum);
            });
        });
    });
}

function renderEmailTemplate(tags, template) {
    let result = JSON.parse(JSON.stringify(template));

    let specialTags = {
        TIMESTAMP: Date.now(),
        HOSTNAME: tags.DOMAIN || os.hostname()
    };

    let walk = (node, nodeKey) => {
        if (!node) {
            return;
        }

        Object.keys(node || {}).forEach(key => {
            if (!node[key] || ['content'].includes(key)) {
                return;
            }

            if (Array.isArray(node[key])) {
                return node[key].forEach(child => walk(child, nodeKey));
            }

            if (typeof node[key] === 'object') {
                return walk(node[key], key);
            }

            if (typeof node[key] === 'string') {
                let isHTML = /html/i.test(key);
                node[key] = node[key].replace(/\[([^\]]+)\]/g, (match, tag) => {
                    if (tag in tags) {
                        return isHTML ? he.encode(tags[tag]) : tags[tag];
                    } else if (tag in specialTags) {
                        return isHTML ? he.encode((specialTags[tag] || '').toString()) : specialTags[tag];
                    }
                    return match;
                });
                return;
            }
        });
    };

    walk(result, false);

    return result;
}

function getEmailTemplates(tags, callback) {
    if (templates) {
        return callback(null, templates.map(template => renderEmailTemplate(tags, template)));
    }
    let templateFolder = pathlib.join(__dirname, '..', 'emails');
    fs.readdir(templateFolder, (err, files) => {
        if (err) {
            return callback(err);
        }

        files = files.sort((a, b) => a.localeCompare(b));

        let pos = 0;
        let filesMap = new Map();

        let checkFiles = () => {
            if (pos >= files.length) {
                let newTemplates = Array.from(filesMap)
                    .map(entry => {
                        let name = escapeRegexStr(entry[0]);
                        entry = entry[1];
                        if (!entry.message) {
                            return false;
                        }

                        if (entry.html) {
                            entry.message.html = entry.html;
                        }

                        if (entry.text) {
                            entry.message.text = entry.text;
                        }

                        if (entry.attachments) {
                            entry.message.attachments = [].concat(entry.message.attachments || []).concat(entry.attachments);

                            if (entry.message.html) {
                                entry.message.attachments.forEach(attachment => {
                                    if (entry.message.html.indexOf(attachment.filename) >= 0) {
                                        // replace html image link with a link to the attachment
                                        let fname = escapeRegexStr(attachment.filename);
                                        entry.message.html = entry.message.html.replace(
                                            new RegExp('(["\'])(?:.\\/)?(?:' + name + '.)?' + fname + '(?=["\'])', 'g'),
                                            (m, p) => {
                                                attachment.cid = attachment.cid || crypto.randomBytes(8).toString('hex') + '-[TIMESTAMP]@[DOMAIN]';
                                                return p + 'cid:' + attachment.cid;
                                            }
                                        );
                                    }
                                });
                            }
                        }

                        if (entry.text) {
                            entry.message.text = entry.text;
                        }

                        return entry.message;
                    })
                    .filter(entry => entry);

                templates = newTemplates;
                return callback(null, templates.map(template => renderEmailTemplate(tags, template)));
            }
            let file = files[pos++];
            let fParts = pathlib.parse(file);
            fs.readFile(pathlib.join(templateFolder, file), (err, value) => {
                if (err) {
                    // ignore?
                    return checkFiles();
                }

                let ext = fParts.ext.toLowerCase();
                let name = fParts.name.toLowerCase();
                if (name.indexOf('.') >= 0) {
                    name = name.substr(0, name.indexOf('.'));
                }

                let type = false;
                switch (ext) {
                    case '.json': {
                        try {
                            value = JSON.parse(value.toString('utf-8'));
                            type = 'message';
                        } catch (E) {
                            //ignore?
                        }
                        break;
                    }
                    case '.html':
                    case '.htm':
                        value = value.toString('utf-8');
                        type = 'html';
                        break;
                    case '.text':
                    case '.txt':
                        value = value.toString('utf-8');
                        type = 'text';
                        break;
                    default: {
                        if (name.length < fParts.name.length) {
                            type = 'attachment';
                            value = {
                                filename: fParts.base.substr(name.length + 1),
                                content: value.toString('base64'),
                                encoding: 'base64'
                            };
                        }
                    }
                }

                if (type) {
                    if (!filesMap.has(name)) {
                        filesMap.set(name, {});
                    }
                    if (type === 'attachment') {
                        if (!filesMap.get(name).attachments) {
                            filesMap.get(name).attachments = [value];
                        } else {
                            filesMap.get(name).attachments.push(value);
                        }
                    } else {
                        filesMap.get(name)[type] = value;
                    }
                }

                return checkFiles();
            });
        };

        checkFiles();
    });
}

function escapeRegexStr(string) {
    let specials = ['-', '[', ']', '/', '{', '}', '(', ')', '*', '+', '?', '.', '\\', '^', '$', '|'];
    return string.replace(RegExp('[' + specials.join('\\') + ']', 'g'), '\\$&');
}

module.exports = {
    normalizeAddress,
    redisConfig,
    checkRangeQuery,
    decodeAddresses,
    getMailboxCounter,
    getEmailTemplates
};
