'use strict';

const punycode = require('punycode');
const libmime = require('libmime');
const consts = require('./consts');

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

module.exports = {
    normalizeAddress,
    redisConfig,
    checkRangeQuery,
    decodeAddresses,
    getMailboxCounter
};
