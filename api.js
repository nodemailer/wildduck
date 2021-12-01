'use strict';

const config = require('wild-config');
const pino = require('pino');

const pathlib = require('path');
const Hapi = require('@hapi/hapi');
const Boom = require('@hapi/boom');
const Inert = require('@hapi/inert');
const Vision = require('@hapi/vision');
const HapiSwagger = require('hapi-swagger');
const hapiPino = require('hapi-pino');
const packageData = require('./package.json');

const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const MessageHandler = require('./lib/message-handler');
const StorageHandler = require('./lib/storage-handler');
const AuditHandler = require('./lib/audit-handler');
const ImapNotifier = require('./lib/imap-notifier');

const db = require('./lib/db');
const certs = require('./lib/certs');

const Gelf = require('gelf');
const os = require('os');
const tls = require('tls');
const Lock = require('ioredfour');

const acmeRoutes = require('./lib/api/acme');
const certsRoutes = require('./lib/api/certs');

const usersRoutes = require('./lib/api/users');
const addressesRoutes = require('./lib/api/addresses');
const mailboxesRoutes = require('./lib/api/mailboxes');
const messagesRoutes = require('./lib/api/messages');
const storageRoutes = require('./lib/api/storage');
const filtersRoutes = require('./lib/api/filters');
const domainaccessRoutes = require('./lib/api/domainaccess');
const aspsRoutes = require('./lib/api/asps');
const totpRoutes = require('./lib/api/2fa/totp');
const custom2faRoutes = require('./lib/api/2fa/custom');
const u2fRoutes = require('./lib/api/2fa/u2f');
const updatesRoutes = require('./lib/api/updates');
const authRoutes = require('./lib/api/auth');
const autoreplyRoutes = require('./lib/api/autoreply');
const submitRoutes = require('./lib/api/submit');
const auditRoutes = require('./lib/api/audit');
const domainaliasRoutes = require('./lib/api/domainaliases');
const dkimRoutes = require('./lib/api/dkim');
const webhooksRoutes = require('./lib/api/webhooks');
const settingsRoutes = require('./lib/api/settings');
const { SettingsHandler } = require('./lib/settings-handler');
const { ObjectId } = require('mongodb');

let userHandler;
let mailboxHandler;
let messageHandler;
let storageHandler;
let auditHandler;
let settingsHandler;
let notifier;
let loggelf;

const REDACTED_KEYS = ['req.headers.authorization', 'req.headers["x-access-token"]', 'req.headers.cookie'];

const logger = pino({ redact: REDACTED_KEYS }).child({
    process: 'api'
});

let certOptions = {};
certs.loadTLSOptions(certOptions, 'api');

const serverOptions = {
    port: config.api.port,
    host: config.api.host,

    routes: {
        cors: {
            origin: ['*'],
            additionalHeaders: ['X-Access-Token'],
            credentials: true
        }
    }
};

if (config.api.secure && certOptions.key) {
    let httpsServerOptions = {};

    httpsServerOptions.key = certOptions.key;
    if (certOptions.ca) {
        httpsServerOptions.ca = certOptions.ca;
    }
    httpsServerOptions.cert = certOptions.cert;

    let defaultSecureContext = tls.createSecureContext(httpsServerOptions);

    httpsServerOptions.SNICallback = (servername, cb) => {
        certs
            .getContextForServername(
                servername,
                httpsServerOptions,
                {
                    source: 'API'
                },
                {
                    loggelf: message => loggelf(message)
                }
            )
            .then(context => {
                cb(null, context || defaultSecureContext);
            })
            .catch(err => cb(err));
    };

    serverOptions.tls = httpsServerOptions;
}

const swaggerOptions = {
    swaggerUI: true,
    swaggerUIPath: '/swagger/',
    documentationPage: true,
    documentationPath: '/docs',

    grouping: 'tags',

    //auth: 'api-token',

    info: {
        title: 'WildDuck Email Server',
        version: packageData.version,
        contact: {
            name: 'Postal Systems OÜ',
            email: 'andris@kreata.ee'
        }
    }
    /*
    securityDefinitions: {
        bearerAuth: {
            type: 'apiKey',
            //scheme: 'bearer',
            name: 'access_token',
            in: 'query'
        }
    },
    security: [{ bearerAuth: [] }]
    */
};

const component = config.log.gelf.component || 'wildduck';
const hostname = config.log.gelf.hostname || os.hostname();
const gelf =
    config.log.gelf && config.log.gelf.enabled
        ? new Gelf(config.log.gelf.options)
        : {
              // placeholder
              emit: (key, message) => logger.info(Object.assign(message, { provider: 'gelf' }))
          };

loggelf = message => {
    if (typeof message === 'string') {
        message = {
            short_message: message
        };
    }
    message = message || {};

    if (!message.short_message || message.short_message.indexOf(component.toUpperCase()) !== 0) {
        message.short_message = component.toUpperCase() + ' ' + (message.short_message || '');
    }

    message.facility = component; // facility is deprecated but set by the driver if not provided
    message.host = hostname;
    message.timestamp = Date.now() / 1000;
    message._component = component;
    Object.keys(message).forEach(key => {
        if (!message[key]) {
            delete message[key];
        }
    });
    gelf.emit('gelf.log', message);
};

async function start() {
    if (!config.api.enabled) {
        return false;
    }

    const server = Hapi.server(serverOptions);

    // Login
    await server.register({
        plugin: hapiPino,
        options: {
            //getChildBindings: request => ({ req: request }),
            instance: logger.child({ provider: 'hapi' }),
            // Redact Authorization headers, see https://getpino.io/#/docs/redaction
            redact: REDACTED_KEYS
        }
    });

    await server.register([
        Inert,
        Vision,
        {
            plugin: HapiSwagger,
            options: swaggerOptions
        }
    ]);

    notifier = new ImapNotifier({
        database: db.database,
        redis: db.redis
    });

    messageHandler = new MessageHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        gridfs: db.gridfs,
        attachments: config.attachments,
        loggelf: message => loggelf(message)
    });

    storageHandler = new StorageHandler({
        database: db.database,
        users: db.users,
        gridfs: db.gridfs,
        loggelf: message => loggelf(message)
    });

    userHandler = new UserHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        messageHandler,
        loggelf: message => loggelf(message)
    });

    /*
    setInterval(() => {
        console.log('Triggering logout');
        userHandler.logout(new ObjectId('5e2a9b67ab7ea4a226529417'), 'Authentication required');
    }, 60 * 1000);
*/

    mailboxHandler = new MailboxHandler({
        database: db.database,
        users: db.users,
        redis: db.redis,
        notifier,
        loggelf: message => loggelf(message)
    });

    auditHandler = new AuditHandler({
        database: db.database,
        users: db.users,
        gridfs: db.gridfs,
        bucket: 'audit',
        loggelf: message => loggelf(message)
    });

    settingsHandler = new SettingsHandler({ db: db.database });

    server.decorate('server', 'loggelf', loggelf);
    server.decorate(
        'server',
        'lock',
        () =>
            new Lock({
                redis: db.redis,
                namespace: 'mail'
            })
    );

    // Hapi lifecycle handlers
    server.ext('onRequest', async (request, h) => {
        // Check for the client IP from the Forwarded-For header
        if (config.api.proxy) {
            const xFF = request.headers['x-forwarded-for'] || '';
            request.app.ip = xFF
                .split(',')
                .concat(request.info.remoteAddress)
                .map(entry => entry.trim())
                .filter(entry => entry)[0];
        } else {
            request.app.ip = request.info.remoteAddress;
        }

        request.app.role = 'root';
        request.validateAcl = permission => {
            if (!permission.granted) {
                let error = Boom.boomify(new Error('Not enough privileges'), { statusCode: 403 });
                error.output.payload.code = 'MissingPrivileges';
                throw error;
            }
        };

        return h.continue;
    });

    // handle Error response
    server.ext('onPreResponse', async (request, h) => {
        const response = request.response;
        if (!response.isBoom) {
            return h.continue;
        }

        const error = response;
        if (error.output && error.output.payload) {
            request.errorInfo = error.output.payload;
        }

        return h.response(request.errorInfo).code(request.errorInfo.statusCode || 500);
    });

    // Static files
    server.route({
        method: 'GET',
        path: '/public/{file*}',
        handler: {
            directory: {
                path: pathlib.join(__dirname, 'public')
            }
        },
        options: {
            auth: false
        }
    });

    // API routes
    acmeRoutes(server, db);
    certsRoutes(server, db);
    dkimRoutes(server, db);
    updatesRoutes(server, db, notifier);

    /*
    usersRoutes(db, server, userHandler, settingsHandler);
    addressesRoutes(db, server, userHandler, settingsHandler);
    mailboxesRoutes(db, server, mailboxHandler);
    messagesRoutes(db, server, messageHandler, userHandler, storageHandler, settingsHandler);
    storageRoutes(db, server, storageHandler);
    filtersRoutes(db, server, userHandler);
    domainaccessRoutes(db, server);
    aspsRoutes(db, server, userHandler);
    totpRoutes(db, server, userHandler);
    custom2faRoutes(db, server, userHandler);
    u2fRoutes(db, server, userHandler);
    
    authRoutes(db, server, userHandler);
    autoreplyRoutes(db, server);
    submitRoutes(db, server, messageHandler, userHandler, settingsHandler);
    auditRoutes(db, server, auditHandler);
    domainaliasRoutes(db, server);
    
    webhooksRoutes(db, server);
    settingsRoutes(db, server, settingsHandler);
    */

    // Not found
    server.route({
        method: '*',
        path: '/{any*}',
        async handler() {
            throw Boom.notFound('Requested page not found'); // 404
        }
    });

    // start listening
    await server.start();

    return server;
}

module.exports = done => {
    start()
        .then(res => done(null, res))
        .catch(done);
};
