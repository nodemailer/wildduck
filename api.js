'use strict';

const config = require('wild-config');
const restify = require('restify');
const log = require('npmlog');
const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const MessageHandler = require('./lib/message-handler');
const ImapNotifier = require('./lib/imap-notifier');
const db = require('./lib/db');
const certs = require('./lib/certs');

const usersRoutes = require('./lib/api/users');
const addressesRoutes = require('./lib/api/addresses');
const mailboxesRoutes = require('./lib/api/mailboxes');
const messagesRoutes = require('./lib/api/messages');
const filtersRoutes = require('./lib/api/filters');
const aspsRoutes = require('./lib/api/asps');
const _2faRoutes = require('./lib/api/2fa');
const updatesRoutes = require('./lib/api/updates');
const authRoutes = require('./lib/api/auth');
const autoreplyRoutes = require('./lib/api/autoreply');

const serverOptions = {
    name: 'Wild Duck API',
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
server.get(
    /\/public\/?.*/,
    restify.plugins.serveStatic({
        directory: __dirname,
        default: 'index.html'
    })
);

server.use((req, res, next) => {
    if (config.api.accessToken && ![req.query.accessToken, req.headers['x-access-token']].includes(config.api.accessToken)) {
        res.status(403);
        res.charSet('utf-8');
        return res.json({
            error: 'Invalid accessToken value'
        });
    }
    if (req.query.accessToken) {
        delete req.query.accessToken;
    }
    next();
});

module.exports = done => {
    if (!config.imap.enabled) {
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
    _2faRoutes(db, server, userHandler);
    updatesRoutes(db, server, notifier);
    authRoutes(db, server, userHandler);
    autoreplyRoutes(db, server);

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
