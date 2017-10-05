'use strict';

const config = require('wild-config');
const log = require('npmlog');
const IRCServer = require('./lib/irc/server');
const UserHandler = require('./lib/user-handler');
const MessageHandler = require('./lib/message-handler');
const db = require('./lib/db');
const fs = require('fs');
const certs = require('./lib/certs');

const serverOptions = {
    port: config.irc.port,
    host: config.irc.host,
    secure: config.irc.secure,

    name: config.irc.name,
    hostname: config.irc.hostname,

    // log to console
    logger: {
        info(...args) {
            args.shift();
            log.info('IRC', ...args);
        },
        debug(...args) {
            args.shift();
            log.silly('IRC', ...args);
        },
        error(...args) {
            args.shift();
            log.error('IRC', ...args);
        }
    }
};

certs.loadTLSOptions(serverOptions, 'irc');

const server = new IRCServer(serverOptions);

config.on('reload', () => {
    // update message of the day
    updateMotd();
});

updateMotd();

module.exports = done => {
    if (!config.irc.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

    server.messageHandler = new MessageHandler({
        database: db.database,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments
    });

    server.userHandler = new UserHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        authlogExpireDays: config.log.authlogExpireDays
    });

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }
        log.error('IRC', err);
    });

    server.listen(config.irc.port, config.irc.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        done(null, server);
    });
};

function updateMotd() {
    if (config.irc.motd.source === 'message') {
        server.motd = config.irc.motd.message;
    } else if (config.irc.motd.source === 'file') {
        fs.readFile(config.irc.motd.file, 'utf-8', (err, motd) => {
            if (err) {
                log.error('IRC', 'Failed to realod MOTD. %s', err.message);
                return;
            }
            server.motd = motd;
        });
    }
}
