'use strict';

const config = require('wild-config');
const restify = require('restify');
const log = require('npmlog');
const logger = require('restify-logger');
const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const MessageHandler = require('./lib/message-handler');
const ImapNotifier = require('./lib/imap-notifier');
const db = require('./lib/db');
const certs = require('./lib/certs');
const tools = require('./lib/tools');
const crypto = require('crypto');

const usersRoutes = require('./lib/api/users');
const addressesRoutes = require('./lib/api/addresses');
const mailboxesRoutes = require('./lib/api/mailboxes');
const messagesRoutes = require('./lib/api/messages');
const filtersRoutes = require('./lib/api/filters');
const aspsRoutes = require('./lib/api/asps');
const totpRoutes = require('./lib/api/2fa/totp');
const custom2faRoutes = require('./lib/api/2fa/custom');
const u2fRoutes = require('./lib/api/2fa/u2f');
const updatesRoutes = require('./lib/api/updates');
const authRoutes = require('./lib/api/auth');
const autoreplyRoutes = require('./lib/api/autoreply');
const submitRoutes = require('./lib/api/submit');
const domainaliasRoutes = require('./lib/api/domainaliases');
const dkimRoutes = require('./lib/api/dkim');

const serverOptions = {
    name: 'WildDuck API',
    strictRouting: true,
    formatters: {
        'application/json; q=0.4': (req, res, body) => {
            let data = body ? JSON.stringify(body, false, 2) + '\n' : 'null';
            res.setHeader('Content-Length', Buffer.byteLength(data));
            return data;
        }
    }
};

let certOptions = {};
certs.loadTLSOptions(certOptions, 'api');

if (config.api.secure && certOptions.key) {
    serverOptions.key = certOptions.key;
    if (certOptions.ca) {
        serverOptions.ca = certOptions.ca;
    }
    serverOptions.certificate = certOptions.cert;
}

const server = restify.createServer(serverOptions);

let userHandler;
let mailboxHandler;
let messageHandler;
let notifier;

// disable compression for EventSource response
// this needs to be called before gzipResponse
server.use((req, res, next) => {
    if (req.route.path === '/users/:user/updates') {
        req.headers['accept-encoding'] = '';
    }
    next();
});

server.use(restify.plugins.gzipResponse());

server.use(restify.plugins.queryParser());
server.use(
    restify.plugins.bodyParser({
        maxBodySize: 0,
        mapParams: true,
        mapFiles: false,
        overrideParams: false
    })
);

server.use(
    tools.asyncifyJson(async (req, res, next) => {
        let accessToken = req.query.accessToken || req.headers['x-access-token'] || false;

        if (req.query.accessToken) {
            req.query.accessToken = '';
        }

        if (req.headers['x-access-token']) {
            req.headers['x-access-token'] = '';
        }

        let tokenRequired = false;

        let fail = () => {
            res.status(403);
            res.charSet('utf-8');
            return res.json({
                error: 'Invalid accessToken value',
                code: 'InvalidToken'
            });
        };

        req.validate = permission => {
            if (!permission.granted) {
                let err = new Error('Not enough privileges');
                err.responseCode = 403;
                err.code = 'MissingPrivileges';
                throw err;
            }
        };

        // hard coded master token
        if (config.api.accessToken) {
            tokenRequired = true;
            if (config.api.accessToken === accessToken) {
                req.role = 'root';
                req.user = 'root';
                return next();
            }
        }

        if (config.api.accessControl.enabled) {
            tokenRequired = true;
            if (accessToken && accessToken.length === 40 && /^[a-fA-F0-9]{40}$/.test(accessToken)) {
                let tokenData;
                let tokenHash = crypto
                    .createHash('sha256')
                    .update(accessToken)
                    .digest('hex');

                try {
                    let key = 'tn:token:' + tokenHash;
                    tokenData = await db.redis.hgetall(key);
                } catch (err) {
                    err.responseCode = 500;
                    err.code = 'InternalDatabaseError';
                    throw err;
                }

                if (tokenData && tokenData.user && tokenData.role && config.api.roles[tokenData.role]) {
                    let signature = crypto
                        .createHmac('sha256', config.api.accessControl.secret)
                        .update(
                            JSON.stringify({
                                token: accessToken,
                                user: tokenData.user,
                                role: tokenData.role
                            })
                        )
                        .digest('hex');

                    if (signature !== tokenData.s) {
                        // rogue token
                        try {
                            await db.redis
                                .multi()
                                .del('tn:token:' + tokenHash)
                                .srem('tn:user:' + tokenData.user, tokenHash)
                                .exec();
                        } catch (err) {
                            // ignore
                        }
                    } else {
                        req.role = tokenData.role;
                        req.user = tokenData.user;
                    }
                    return next();
                }
            }
        }

        if (tokenRequired) {
            // no valid token found
            return fail();
        }

        // allow all
        req.role = 'root';
        req.user = 'root';
        next();
    })
);

logger.token('user-ip', req => ((req.body && req.body.ip) || (req.query && req.query.ip) || '').toString().substr(0, 40) || '-');
logger.token('user-sess', req => (req.body && req.body.sess) || (req.query && req.query.sess) || '-');

logger.token('user', req => (req.user && req.user.toString()) || '-');
logger.token('url', req => {
    if (/\baccessToken=/.test(req.url)) {
        return req.url.replace(/\baccessToken=[^&]+/g, 'accessToken=' + 'x'.repeat(6));
    }
    return req.url;
});

server.use(
    logger(':remote-addr :user [:user-ip/:user-sess] :method :url :status :time-spent :append', {
        stream: {
            write: message => {
                message = (message || '').toString();
                if (message) {
                    log.http('API', message.replace('\n', '').trim());
                }
            }
        }
    })
);

module.exports = done => {
    if (!config.api.enabled) {
        return setImmediate(() => done(null, false));
    }

    let started = false;

    notifier = new ImapNotifier({
        database: db.database,
        redis: db.redis
    });

    messageHandler = new MessageHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments
    });

    userHandler = new UserHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        messageHandler,
        authlogExpireDays: config.log.authlogExpireDays
    });

    mailboxHandler = new MailboxHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        notifier
    });

    usersRoutes(db, server, userHandler);
    addressesRoutes(db, server);
    mailboxesRoutes(db, server, mailboxHandler);
    messagesRoutes(db, server, messageHandler);
    filtersRoutes(db, server);
    aspsRoutes(db, server, userHandler);
    totpRoutes(db, server, userHandler);
    custom2faRoutes(db, server, userHandler);
    u2fRoutes(db, server, userHandler);
    updatesRoutes(db, server, notifier);
    authRoutes(db, server, userHandler);
    autoreplyRoutes(db, server);
    submitRoutes(db, server, messageHandler, userHandler);
    domainaliasRoutes(db, server);
    dkimRoutes(db, server);

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }

        log.error('API', err);
    });

    server.listen(config.api.port, config.api.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        log.info('API', 'Server listening on %s:%s', config.api.host || '0.0.0.0', config.api.port);
        done(null, server);
    });
};
