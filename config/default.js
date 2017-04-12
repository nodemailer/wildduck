'use strict';

module.exports = {
    log: {
        level: 'silly'
    },

    // downgrade process user after binding to ports
    //user: 'wildduck',
    //group: 'wildduck',

    // log to syslog if true
    syslog: false,

    // process title and syslog ident
    ident: 'wildduck',

    // how many processes to start
    processes: 1,

    mongo: 'mongodb://127.0.0.1:27017/wildduck',

    redis: 'redis://127.0.0.1:6379/3',

    imap: {
        port: 9993,
        host: '127.0.0.1',
        // If certificate path is not defined, use built-in self-signed certs
        //key: '/path/to/server/key.pem'
        //cert: '/path/to/server/cert.pem'
        secure: true,
        // Max size for messages uploaded via APPEND
        maxMB: 5
    },

    lmtp: {
        enabled: true,
        port: 2525,
        // If certificate path is not defined, use built-in self-signed certs for STARTTLS
        //key: '/path/to/server/key.pem'
        //cert: '/path/to/server/cert.pem'
        host: '0.0.0.0',
        maxMB: 5
    },

    pop3: {
        enabled: true,
        port: 9995,
        host: '0.0.0.0',
        // If certificate path is not defined, use built-in self-signed certs
        //key: '/path/to/server/key.pem'
        //cert: '/path/to/server/cert.pem'
        secure: true,
        // how many latest messages to list for LIST and UIDL
        maxMessages: 250
    },

    api: {
        port: 8080
    },

    // if this header exists and starts with yes then the message is treated as spam
    spamHeader: 'X-Rspamd-Spam',

    // default quota storage in MB (can be overriden per user)
    maxStorage: 1000,

    // default smtp recipients for 24h (can be overriden per user)
    maxRecipients: 2000
};
