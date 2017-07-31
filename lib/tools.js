'use strict';

const punycode = require('punycode');
const libmime = require('libmime');
const consts = require('./consts');
const fs = require('fs');
const he = require('he');
const pathlib = require('path');

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

    let walk = (node, nodeKey) => {
        if (!node) {
            return;
        }

        Object.keys(node || {}).forEach(key => {
            if (!node[key]) {
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
        let newTemplates = [];
        let checkFiles = () => {
            if (pos >= files.length) {
                templates = newTemplates;
                return callback(null, templates.map(template => renderEmailTemplate(tags, template)));
            }
            let file = files[pos++];
            if (!/\.json$/i.test(file)) {
                return checkFiles();
            }
            fs.readFile(pathlib.join(templateFolder, file), 'utf-8', (err, email) => {
                if (err) {
                    // ignore?
                    return checkFiles();
                }
                let parsed;
                try {
                    parsed = JSON.parse(email);
                } catch (E) {
                    //ignore?
                }
                if (parsed) {
                    newTemplates.push(parsed);
                }
                return checkFiles();
            });
        };

        checkFiles();
    });
}

module.exports = {
    normalizeAddress,
    redisConfig,
    checkRangeQuery,
    decodeAddresses,
    getMailboxCounter,
    getEmailTemplates
};
