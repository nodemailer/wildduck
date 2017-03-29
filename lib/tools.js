'use strict';

const punycode = require('punycode');

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
    let addr = user + '@' + punycode.toUnicode(domain);

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

module.exports = {
    normalizeAddress,
    redisConfig
};
