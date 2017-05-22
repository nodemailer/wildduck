'use strict';

const os = require('os');

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
        enabled: true,
        port: 9993,
        host: '127.0.0.1',

        // If certificate path is not defined, use built-in self-signed certs
        //key: '/path/to/server/key.pem'
        //cert: '/path/to/server/cert.pem'
        secure: true,

        // Max size for messages uploaded via APPEND
        maxMB: 5,

        // delete messages from Trash and Junk after retention days
        retention: 30
    },

    lmtp: {
        enabled: true,
        port: 2424,
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
        enabled: true,
        port: 8080,
        host: '0.0.0.0'
    },

    // push messages to ZoneMTA queue for delivery
    sender: {
        // if false, then no messages are sent
        enabled: true,

        // which ZoneMTA queue to use by default
        zone: 'default',

        // MongoDB connection url. Do not set if you want to use main database
        mongo: 'mongodb://127.0.0.1:27017/zone-mta',

        // Collection name for GridFS storage
        gfs: 'mail',

        // Collection name for the queue
        collection: 'zone-queue'
    },

    // if this header exists and starts with yes then the message is treated as spam
    spamHeader: 'X-Rspamd-Spam',

    // default quota storage in MB (can be overriden per user)
    maxStorage: 1024,

    // default smtp recipients for 24h (can be overriden per user)
    maxRecipients: 2000,

    // default forwarded messages for 24h (can be overriden per user)
    maxForwards: 2000,

    emailDomain: os.hostname()
};
