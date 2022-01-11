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

const { checkAccessToken, deleteAccessToken } = require('./lib/access-tokens');
const roles = require('./lib/roles');

const db = require('./lib/db');
const certs = require('./lib/certs');

const Gelf = require('gelf');
const os = require('os');
const tls = require('tls');
const Lock = require('ioredfour');

const HapiToken = require('./lib/hapi-token');

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
const domainaliasesRoutes = require('./lib/api/domainaliases');
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

let swaggerOptions = {
    swaggerUI: true,
    swaggerUIPath: '/swagger/',
    documentationPage: true,
    documentationPath: '/docs',

    grouping: 'tags',

    auth: false,

    info: {
        title: 'WildDuck Email Server',
        version: packageData.version,
        contact: {
            name: 'Postal Systems OÜ',
            email: 'andris@kreata.ee'
        }
    }
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

const getRequestIp = request => {
    // Check for the client IP from the Forwarded-For header
    if (config.api.proxy) {
        const xFF = request.headers['x-forwarded-for'] || '';
        return xFF
            .split(',')
            .concat(request.info.remoteAddress)
            .map(entry => entry.trim())
            .filter(entry => entry)[0];
    } else {
        return request.info.remoteAddress;
    }
};

async function start() {
    if (!config.api.enabled) {
        return false;
    }

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

    const server = Hapi.server(serverOptions);

    // Login
    await server.register({
        plugin: hapiPino,
        options: {
            //getChildBindings: request => ({ req: request }),
            instance: logger.child({ provider: 'hapi' }),
            // Redact Authorization headers, see https://getpino.io/#/docs/redaction
            redact: REDACTED_KEYS,
            logQueryParams: true,
            logPayload: false,
            logRouteTags: true
        },

        router: {
            stripTrailingSlash: true
        }
    });

    await server.register(HapiToken);

    server.auth.strategy('token', 'access-token', {
        validate: async (request, token /*, h */) => {
            // here is where you validate your token
            // comparing with token from your database for example

            try {
                if (!token) {
                    if (!config.api.accessControl.enabled && !config.api.accessToken) {
                        // default role if authentication is not required
                        request.app.role = 'root';
                        request.app.user = 'root';
                        request.app.accessToken = false;

                        return { status: 'valid', credentials: { user: request.app.user }, artifacts: { auth: 'disabled', role: request.app.role } };
                    }

                    return { status: 'missing' };
                }

                if (config.api.accessToken === token) {
                    // root token
                    request.app.role = 'root';
                    request.app.user = 'root';
                    request.app.accessToken = false;

                    return { status: 'valid', credentials: { user: request.app.user }, artifacts: { auth: 'enabled', role: request.app.role } };
                }

                let { user, role } = await checkAccessToken(token);
                if (!user || !role) {
                    return { status: 'fail' };
                }

                request.app.role = role;
                request.app.user = user;
                request.app.accessToken = token;

                if (request.params.user === 'me') {
                    if (/^[0-9a-f]{24}$/i.test(user)) {
                        request.params.user = user;
                    } else {
                        let error = Boom.boomify(new Error('Can not assign an account'), { statusCode: 403 });
                        error.output.payload.code = 'NonAccountUser';
                        throw error;
                    }
                }

                return { status: 'valid', credentials: { user: request.app.user }, artifacts: { auth: 'enabled', role: request.app.role } };
            } finally {
                if (request.app.user && request.app.role) {
                    request.logger.info({ user: request.app.user, role: request.app.role }, 'user authorized');
                }
            }
        }
    });

    server.auth.default('token');

    if (config.api.accessControl.enabled || config.api.accessToken) {
        swaggerOptions = Object.assign(swaggerOptions, {
            securityDefinitions: {
                bearerAuth: {
                    type: 'apiKey',
                    //scheme: 'bearer',
                    name: 'accessToken',
                    in: 'query'
                }
            },
            security: [{ bearerAuth: [] }]
        });
    }

    await server.register([
        Inert,
        Vision,
        {
            plugin: HapiSwagger,
            options: swaggerOptions
        }
    ]);

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

    // update version info of an access token
    server.decorate(
        'request',
        'updateAccessToken',
        request => async () => {
            if (!request.app.accessToken) {
                return false;
            }
            await userHandler.setAuthToken(request.app.user, request.app.accessToken);
        },
        {
            apply: true
        }
    );

    server.decorate(
        'request',
        'deleteAccessToken',
        request => async () => {
            if (!request.app.accessToken) {
                return false;
            }
            return await deleteAccessToken(request.app.accessToken);
        },
        {
            apply: true
        }
    );

    server.decorate('request', 'validateAcl', permission => {
        if (!permission.granted) {
            let error = Boom.boomify(new Error('Not enough privileges'), { statusCode: 403 });
            error.output.payload.code = 'MissingPrivileges';
            throw error;
        }
    });

    // Hapi lifecycle handlers
    server.ext('onRequest', async (request, h) => {
        // Check for the client IP from the Forwarded-For header
        request.app.ip = getRequestIp(request);
        request.app.role = false;

        return h.continue;
    });

    server.ext('onPostAuth', async (request, h) => {
        for (let key of ['ip', 'sess']) {
            if (request.payload && request.payload[key]) {
                if (!request.query[key]) {
                    request.query[key] = request.payload[key];
                }
                delete request.payload[key];
            }
        }

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

        request.logger.error({ msg: 'Request failed', err: error });

        const statusCode = request.errorInfo.statusCode || 500;
        return h.response(request.errorInfo || { statusCode }).code(statusCode);
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
    domainaliasesRoutes(server, db);
    authRoutes(server, db, userHandler);
    usersRoutes(server, db, userHandler, settingsHandler);
    addressesRoutes(server, db, userHandler, settingsHandler);

    /*
    mailboxesRoutes(db, server, mailboxHandler);
    messagesRoutes(db, server, messageHandler, userHandler, storageHandler, settingsHandler);
    storageRoutes(db, server, storageHandler);
    filtersRoutes(db, server, userHandler);
    domainaccessRoutes(db, server);
    aspsRoutes(db, server, userHandler);
    totpRoutes(db, server, userHandler);
    custom2faRoutes(db, server, userHandler);
    u2fRoutes(db, server, userHandler);
    
    
    autoreplyRoutes(db, server);
    submitRoutes(db, server, messageHandler, userHandler, settingsHandler);
    auditRoutes(db, server, auditHandler);
    
    
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
