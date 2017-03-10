'use strict';

module.exports = {
    log: {
        level: 'silly'
    },

    mongo: 'mongodb://127.0.0.1:27017/wildduck',
    redis: {
        host: 'localhost',
        port: 6379,
        db: 3
    },

    imap: {
        port: 9998,
        host: '127.0.0.1'
    },

    lmtp: {
        enabled: true,
        port: 3424,
        host: '0.0.0.0',
        maxMB: 25
    },

    smtp: {
        enabled: true,
        port: 3525,
        host: '0.0.0.0',
        maxMB: 25
    },

    api: {
        port: 8380
    }
};
