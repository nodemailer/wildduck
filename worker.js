'use strict';

const config = require('wild-config');
const imap = require('./imap');
const pop3 = require('./pop3');
const lmtp = require('./lmtp');
const api = require('./api');
const acme = require('./acme');
const tasks = require('./tasks');
const webhooks = require('./webhooks');
const plugins = require('./lib/plugins');
const db = require('./lib/db');
const errors = require('./lib/errors');
const pino = require('pino');
const logger = pino().child({
    process: 'worker'
});

// preload certificate files
require('./lib/certs');

// Initialize database connection
db.connect(err => {
    if (err) {
        logger.error({ provider: 'db', msg: 'Failed to setup database connection', err });
        errors.notify(err);
        return setTimeout(() => process.exit(1), 3000);
    }

    tasks.start(err => {
        if (err) {
            logger.error({ provider: 'app', msg: 'Failed to start task runner', err });
            errors.notify(err);
            return setTimeout(() => process.exit(1), 3000);
        }

        webhooks.start(err => {
            if (err) {
                logger.error({ provider: 'app', msg: 'Failed to start webhook runner', err });
                errors.notify(err);
                return setTimeout(() => process.exit(1), 3000);
            }

            // Start IMAP server
            imap(err => {
                if (err) {
                    logger.error({ provider: 'app', msg: 'Failed to start IMAP server', err });
                    errors.notify(err);
                    return setTimeout(() => process.exit(1), 3000);
                }
                // Start POP3 server
                pop3(err => {
                    if (err) {
                        logger.error({ provider: 'app', msg: 'Failed to start POP3 server', err });
                        errors.notify(err);
                        return setTimeout(() => process.exit(1), 3000);
                    }
                    // Start LMTP maildrop server
                    lmtp(err => {
                        if (err) {
                            logger.error({ provider: 'app', msg: 'Failed to start LMTP server' }, err);
                            errors.notify(err);
                            return setTimeout(() => process.exit(1), 3000);
                        }

                        // Start HTTP API server
                        api(err => {
                            if (err) {
                                logger.error({ provider: 'app', msg: 'Failed to start API server', err });
                                errors.notify(err);
                                return setTimeout(() => process.exit(1), 3000);
                            }

                            // Start HTTP ACME server
                            acme(err => {
                                if (err) {
                                    logger.error({ provider: 'app', msg: 'Failed to start ACME server', err });
                                    errors.notify(err);
                                    return setTimeout(() => process.exit(1), 3000);
                                }

                                // downgrade user and group if needed
                                if (config.group) {
                                    try {
                                        process.setgid(config.group);
                                        logger.info({ provider: 'app', msg: 'Changed group', group: config.group, gid: process.getgid() });
                                    } catch (E) {
                                        logger.error({ provider: 'app', msg: 'Failed to change group', group: config.group, E });
                                        errors.notify(E);
                                        return setTimeout(() => process.exit(1), 3000);
                                    }
                                }
                                if (config.user) {
                                    try {
                                        process.setuid(config.user);
                                        logger.info({ provider: 'app', msg: 'Changed user', user: config.user, uid: process.getuid() });
                                    } catch (E) {
                                        logger.error({ provider: 'app', msg: 'Failed to change user', user: config.user, E });
                                        errors.notify(E);
                                        return setTimeout(() => process.exit(1), 3000);
                                    }
                                }

                                plugins.init(err => {
                                    if (err) {
                                        logger.error({ provider: 'app', msg: 'Failed to start plugins', err });
                                        errors.notify(err);
                                        return setTimeout(() => process.exit(1), 3000);
                                    }

                                    plugins.runHooks('init', () => {
                                        logger.info({ provider: 'app', msg: 'All servers started, ready to process some mail' });
                                    });
                                });
                            });
                        });
                    });
                });
            });
        });
    });
});
