'use strict';

let config = require('config');
let log = require('npmlog');
let imap = require('./imap');
let lmtp = require('./lmtp');
let smtp = require('./smtp');
let api = require('./api');

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
        smtp(imap, err => {
            if (err) {
                log.error('App', 'Failed to start SMTP server');
                return process.exit(1);
            }
            api(imap, err => {
                if (err) {
                    log.error('App', 'Failed to start API server');
                    return process.exit(1);
                }
                log.info('App', 'All servers started, ready to process some mail');

                // downgrade user if needed
                if (config.group) {
                    try {
                        process.setgid(config.group);
                        log.info('App', 'Changed group to "%s" (%s)', config.group, process.getgid());
                    } catch (E) {
                        log.error('App', 'Failed to change group to "%s" (%s)', config.group, E.message);
                        return process.exit(1);
                    }
                }
                if (config.user) {
                    try {
                        process.setuid(config.user);
                        log.info('App', 'Changed user to "%s" (%s)', config.user, process.getuid());
                    } catch (E) {
                        log.error('App', 'Failed to change user to "%s" (%s)', config.user, E.message);
                        return process.exit(1);
                    }
                }
            });
        });
    });
});
