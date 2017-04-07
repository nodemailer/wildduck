'use strict';

const config = require('config');
const log = require('npmlog');
const POP3Server = require('./lib/pop3-server');
const fs = require('fs');
const bcrypt = require('bcryptjs');
const db = require('./lib/db');

const serverOptions = {
    port: config.pop3.port,
    host: config.pop3.host,
    secure: config.pop3.secure,

    // log to console
    logger: {
        info(...args) {
            args.shift();
            log.info('POP3', ...args);
        },
        debug(...args) {
            args.shift();
            log.silly('POP3', ...args);
        },
        error(...args) {
            args.shift();
            log.error('POP3', ...args);
        }
    },

    onAuth(auth, session, next) {
        db.database.collection('users').findOne({
            username: auth.username
        }, (err, user) => {
            if (err) {
                return next(err);
            }

            if (!user || !bcrypt.compareSync(auth.password, user.password)) {
                return next(null, {
                    message: 'Authentication failed'
                });
            }

            next(null, {
                user: {
                    id: user._id,
                    username: user.username
                }
            });
        });
    }

};

if (config.pop3.key) {
    serverOptions.key = fs.readFileSync(config.pop3.key);
}

if (config.pop3.cert) {
    serverOptions.cert = fs.readFileSync(config.pop3.cert);
}

const server = new POP3Server(serverOptions);

module.exports = done => {
    if (!config.pop3.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }
        log.error('POP3', err);
    });

    server.listen(config.pop3.port, config.pop3.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        done(null, server);
    });
};
