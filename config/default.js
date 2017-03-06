'use strict';

module.exports = {
    log: {
        level: 'silly'
    },

    mongo: 'mongodb://127.0.0.1:27017/wildduck',

    imap: {
        port: 9993,
        host: '127.0.0.1'
    },

    lmtp: {
        enabled: true,
        port: 2424,
        host: '0.0.0.0',
        maxMB: 5
    },

    smtp: {
        enabled: true,
        port: 2525,
        host: '0.0.0.0',
        maxMB: 5
    },

    api: {
        port: 8080
    }
};
