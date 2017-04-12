'use strict';

let config = require('config');
let log = require('npmlog');
let imap = require('./imap');
let pop3 = require('./pop3');
let lmtp = require('./lmtp');
let api = require('./api');
let db = require('./lib/db');

// Initialize database connection
db.connect(err => {
    if (err) {
        log.error('Db', 'Failed to setup database connection');
        return process.exit(1);
    }
    // Start IMAP server
    imap(err => {
        if (err) {
            log.error('App', 'Failed to start IMAP server');
            return process.exit(1);
        }
        // Start POP3 server
        pop3(err => {
            if (err) {
                log.error('App', 'Failed to start POP3 server');
                return process.exit(1);
            }
            // Start LMTP maildrop server
            lmtp(err => {
                if (err) {
                    log.error('App', 'Failed to start LMTP server');
                    return process.exit(1);
                }

                // Start HTTP API server
                api(err => {
                    if (err) {
                        log.error('App', 'Failed to start API server');
                        return process.exit(1);
                    }

                    log.info('App', 'All servers started, ready to process some mail');

                    // downgrade user and group if needed
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
});
