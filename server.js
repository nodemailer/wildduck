'use strict';

let config = require('config');
let log = require('npmlog');
let imap = require('./imap');
let lmtp = require('./lmtp');
let api = require('./api');

log.level = config.log.level;

imap((err, imap) => {
    if (err) {
        log.error('App', 'Failed to start IMAP server');
        return process.exit(1);
    }
    lmtp(imap, err => {
        if (err) {
            log.error('App', 'Failed to start LMTP server');
            return process.exit(1);
        }
        api(imap, err => {
            if (err) {
                log.error('App', 'Failed to start API server');
                return process.exit(1);
            }
            log.info('App', 'All servers started, ready to process some mail');
        });
    });
});
