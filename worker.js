'use strict';

const config = require('config');
const fs = require('fs');

// load certificate files
[config.tls, config.imap.tls, config.lmtp.tls, config.pop3.tls].forEach(tlsconf => {
    if (!tlsconf) {
        return;
    }
    if (tlsconf.key) {
        tlsconf.key = fs.readFileSync(tlsconf.key, 'ascii');
    }

    if (tlsconf.cert) {
        tlsconf.cert = fs.readFileSync(tlsconf.cert, 'ascii');
    }

    if (tlsconf.ca) {
        tlsconf.ca = [].concat(tlsconf.ca || []).map(ca => fs.readFileSync(ca, 'ascii'));
        if (!tlsconf.ca.length) {
            tlsconf.ca = false;
        }
    }
});

const log = require('npmlog');
const imap = require('./imap');
const pop3 = require('./pop3');
const lmtp = require('./lmtp');
const api = require('./api');
const db = require('./lib/db');

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
