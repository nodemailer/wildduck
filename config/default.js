'use strict';

module.exports = {
    log: {
        level: 'silly'
    },

    imap: {
        port: 9993,
        host: '127.0.0.1',
        maxUnflaggedMessages: 10
    },

    mongo: 'mongodb://127.0.0.1:27017/wildduck',

    mx: {
        port: 2525,
        host: '0.0.0.0',
        maxMB: 2
    }
};
