'use strict';

const log = require('npmlog');
const config = require('wild-config');
const IMAPServerModule = require('./imap-core');
const IMAPServer = IMAPServerModule.IMAPServer;
const ImapNotifier = require('./lib/imap-notifier');
const Indexer = require('./imap-core/lib/indexer/indexer');
const MessageHandler = require('./lib/message-handler');
const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const db = require('./lib/db');
const packageData = require('./package.json');
const certs = require('./lib/certs');

const onFetch = require('./lib/handlers/on-fetch');
const onAuth = require('./lib/handlers/on-auth');
const onList = require('./lib/handlers/on-list');
const onLsub = require('./lib/handlers/on-lsub');
const onSubscribe = require('./lib/handlers/on-subscribe');
const onUnsubscribe = require('./lib/handlers/on-unsubscribe');
const onCreate = require('./lib/handlers/on-create');
const onRename = require('./lib/handlers/on-rename');
const onDelete = require('./lib/handlers/on-delete');
const onOpen = require('./lib/handlers/on-open');
const onStatus = require('./lib/handlers/on-status');
const onAppend = require('./lib/handlers/on-append');
const onStore = require('./lib/handlers/on-store');
const onExpunge = require('./lib/handlers/on-expunge');
const onCopy = require('./lib/handlers/on-copy');
const onMove = require('./lib/handlers/on-move');
const onSearch = require('./lib/handlers/on-search');
const onGetQuotaRoot = require('./lib/handlers/on-get-quota-root');
const onGetQuota = require('./lib/handlers/on-get-quota');

let logger = {
    info(...args) {
        args.shift();
        log.info('IMAP', ...args);
    },
    debug(...args) {
        args.shift();
        log.silly('IMAP', ...args);
    },
    error(...args) {
        args.shift();
        log.error('IMAP', ...args);
    }
};

let indexer;
let notifier;
let messageHandler;
let userHandler;
let mailboxHandler;

let createInterface = (ifaceOptions, callback) => {
    // Setup server
    const serverOptions = {
        secure: ifaceOptions.secure,
        secured: ifaceOptions.secured,

        disableSTARTTLS: ifaceOptions.disableSTARTTLS,
        ignoreSTARTTLS: ifaceOptions.ignoreSTARTTLS,

        useProxy: !!config.imap.useProxy,
        ignoredHosts: config.imap.ignoredHosts,

        id: {
            name: config.imap.name || 'WildDuck IMAP Server',
            version: config.imap.version || packageData.version,
            vendor: config.imap.vendor || 'Kreata'
        },

        logger,

        maxMessage: config.imap.maxMB * 1024 * 1024,
        maxStorage: config.maxStorage * 1024 * 1024
    };

    certs.loadTLSOptions(serverOptions, 'imap');

    const server = new IMAPServer(serverOptions);

    certs.registerReload(server, 'imap');

    let started = false;
    server.on('error', err => {
        if (!started) {
            started = true;
            return callback(err);
        }

        logger.error(
            {
                err
            },
            '%s',
            err.message
        );
    });

    server.indexer = indexer;
    server.notifier = notifier;

    // setup command handlers for the server instance
    server.onFetch = onFetch(server, messageHandler, userHandler.userCache);
    server.onAuth = onAuth(server, userHandler, userHandler.userCache);
    server.onList = onList(server);
    server.onLsub = onLsub(server);
    server.onSubscribe = onSubscribe(server);
    server.onUnsubscribe = onUnsubscribe(server);
    server.onCreate = onCreate(server, mailboxHandler);
    server.onRename = onRename(server, mailboxHandler);
    server.onDelete = onDelete(server, mailboxHandler);
    server.onOpen = onOpen(server);
    server.onStatus = onStatus(server);
    server.onAppend = onAppend(server, messageHandler, userHandler.userCache);
    server.onStore = onStore(server);
    server.onExpunge = onExpunge(server, messageHandler);
    server.onCopy = onCopy(server, messageHandler);
    server.onMove = onMove(server, messageHandler);
    server.onSearch = onSearch(server);
    server.onGetQuotaRoot = onGetQuotaRoot(server);
    server.onGetQuota = onGetQuota(server);

    // start listening
    server.listen(ifaceOptions.port, ifaceOptions.host, () => {
        if (started) {
            return server.close();
        }
        started = true;
        callback(null, server);
    });
};

module.exports = done => {
    if (!config.imap.enabled) {
        return setImmediate(() => done(null, false));
    }

    indexer = new Indexer({
        database: db.database
    });

    // setup notification system for updates
    notifier = new ImapNotifier({
        database: db.database,
        redis: db.redis
    });

    messageHandler = new MessageHandler({
        database: db.database,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments
    });

    userHandler = new UserHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        authlogExpireDays: config.log.authlogExpireDays
    });

    mailboxHandler = new MailboxHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        notifier
    });

    let ifaceOptions = [
        {
            enabled: true,
            secure: config.imap.secure,
            disableSTARTTLS: config.imap.disableSTARTTLS,
            ignoreSTARTTLS: config.imap.ignoreSTARTTLS,
            host: config.imap.host,
            port: config.imap.port
        }
    ]
        .concat(config.imap.interface || [])
        .filter(iface => iface.enabled);

    let iPos = 0;
    let startInterfaces = () => {
        if (iPos >= ifaceOptions.length) {
            return done();
        }
        let opts = ifaceOptions[iPos++];

        createInterface(opts, err => {
            if (err) {
                logger.error(
                    {
                        err,
                        tnx: 'bind'
                    },
                    'Failed starting %sIMAP interface %s:%s. %s',
                    opts.secure ? 'secure ' : '',
                    opts.host,
                    opts.port,
                    err.message
                );
                return done(err);
            }
            setImmediate(startInterfaces);
        });
    };
    setImmediate(startInterfaces);
};
