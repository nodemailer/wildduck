'use strict';

const config = require('wild-config');
const restify = require('restify');
const log = require('npmlog');
const logger = require('restify-logger');
const UserHandler = require('./lib/user-handler');
const MailboxHandler = require('./lib/mailbox-handler');
const MessageHandler = require('./lib/message-handler');
const StorageHandler = require('./lib/storage-handler');
const AuditHandler = require('./lib/audit-handler');
const ImapNotifier = require('./lib/imap-notifier');
const db = require('./lib/db');
const certs = require('./lib/certs');
const tools = require('./lib/tools');
const consts = require('./lib/consts');
const crypto = require('crypto');
const Gelf = require('gelf');
const os = require('os');
const util = require('util');
const ObjectID = require('mongodb').ObjectID;

const usersRoutes = require('./lib/api/users');
const teamsRoutes = require('./lib/api/teams');
const addressesRoutes = require('./lib/api/addresses');
const mailboxesRoutes = require('./lib/api/mailboxes');
const messagesRoutes = require('./lib/api/messages');
const storageRoutes = require('./lib/api/storage');
const filtersRoutes = require('./lib/api/filters');
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

let userHandler;
let mailboxHandler;
let messageHandler;
let storageHandler;
let auditHandler;
let notifier;
let loggelf;

const serverOptions = {
    name: 'WildDuck API',
    strictRouting: true,
    maxParamLength: 196,
    formatters: {
        'application/json; q=0.4': (req, res, body) => {
            let data = body ? JSON.stringify(body, false, 2) + '\n' : 'null';
            let size = Buffer.byteLength(data);
            res.setHeader('Content-Length', size);
            if (!body) {
                return data;
            }

            let path = (req.route && req.route.path) || (req.url || '').replace(/(accessToken=)[^&]+/, '$1xxxxxx');

            let message = {
                short_message: 'HTTP [' + req.method + ' ' + path + '] ' + (body.success ? 'OK' : 'FAILED'),

                _remote_ip: req.headers['x-forwarded-for'] || req.connection.remoteAddress,

                _ip: ((req.body && req.body.ip) || (req.query && req.query.ip) || '').toString().substr(0, 40) || '',
                _sess: ((req.body && req.body.sess) || (req.query && req.query.sess) || '').toString().substr(0, 40) || '',

                _http_route: path,
                _http_method: req.method,
                _user: req.user,
                _role: req.role,

                _api_response: body.success ? 'success' : 'fail',

                _error: body.error,
                _code: body.code,

                _size: size
            };

            Object.keys(req.params || {}).forEach(key => {
                let value = typeof req.params[key] === 'string' ? req.params[key] : util.inspect(req.params[key], false, 3).toString().trim();

                if (!value) {
                    return;
                }

                if (['password'].includes(key)) {
                    value = '***';
                } else if (value.length > 128) {
                    value = value.substr(0, 128) + '…';
                }

                if (key.length > 30) {
                    key = key.substr(0, 30) + '…';
                }

                message['_req_' + key] = value;
            });

            Object.keys(body).forEach(key => {
                let value = body[key];
                if (!body || !['id'].includes(key)) {
                    return;
                }
                value = typeof value === 'string' ? value : util.inspect(value, false, 3).toString().trim();

                if (value.length > 128) {
                    value = value.substr(0, 128) + '…';
                }

                if (key.length > 30) {
                    key = key.substr(0, 30) + '…';
                }

                message['_res_' + key] = value;
            });

            loggelf(message);

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

// disable compression for EventSource response
// this needs to be called before gzipResponse
server.use((req, res, next) => {
    if (req.route.path === '/users/:user/updates') {
        req.headers['accept-encoding'] = '';
    }
    next();
});

server.use(restify.plugins.gzipResponse());

server.use(restify.plugins.queryParser({ allowDots: true }));
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
            // delete or it will conflict with Joi schemes
            delete req.query.accessToken;
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

        if (config.api.accessControl.enabled || accessToken) {
            tokenRequired = true;
            if (accessToken && accessToken.length === 40 && /^[a-fA-F0-9]{40}$/.test(accessToken)) {
                let tokenData;
                let tokenHash = crypto.createHash('sha256').update(accessToken).digest('hex');

                try {
                    let key = 'tn:token:' + tokenHash;
                    tokenData = await db.redis.hgetall(key);
                } catch (err) {
                    err.responseCode = 500;
                    err.code = 'InternalDatabaseError';
                    throw err;
                }

                if (tokenData && tokenData.user && tokenData.role && config.api.roles[tokenData.role]) {
                    let signData;
                    if ('authVersion' in tokenData) {
                        // cast value to number
                        tokenData.authVersion = Number(tokenData.authVersion) || 0;
                        signData = {
                            token: accessToken,
                            user: tokenData.user,
                            authVersion: tokenData.authVersion,
                            role: tokenData.role
                        };
                    } else {
                        signData = {
                            token: accessToken,
                            user: tokenData.user,
                            role: tokenData.role
                        };
                    }

                    let signature = crypto.createHmac('sha256', config.api.accessControl.secret).update(JSON.stringify(signData)).digest('hex');

                    if (signature !== tokenData.s) {
                        // rogue token or invalidated secret
                        /*
                        // do not delete just in case there is something wrong with the check
                        try {
                            await db.redis
                                .multi()
                                .del('tn:token:' + tokenHash)
                                .exec();
                        } catch (err) {
                            // ignore
                        }
                        */
                    } else if (tokenData.ttl && !isNaN(tokenData.ttl) && Number(tokenData.ttl) > 0) {
                        let tokenTTL = Number(tokenData.ttl);
                        let tokenLifetime = config.api.accessControl.tokenLifetime || consts.ACCESS_TOKEN_MAX_LIFETIME;

                        // check if token is not too old
                        if ((Date.now() - Number(tokenData.created)) / 1000 < tokenLifetime) {
                            // token is still usable, increase session length
                            try {
                                await db.redis
                                    .multi()
                                    .expire('tn:token:' + tokenHash, tokenTTL)
                                    .exec();
                            } catch (err) {
                                // ignore
                            }
                            req.role = tokenData.role;
                            req.user = tokenData.user;

                            // make a reference to original method, otherwise might be overrided
                            let setAuthToken = userHandler.setAuthToken.bind(userHandler);

                            req.accessToken = {
                                hash: tokenHash,
                                user: tokenData.user,
                                // if called then refreshes token data for current hash
                                update: async () => setAuthToken(tokenData.user, accessToken)
                            };
                        } else {
                            // expired token, clear it
                            try {
                                await db.redis
                                    .multi()
                                    .del('tn:token:' + tokenHash)
                                    .exec();
                            } catch (err) {
                                // ignore
                            }
                        }
                    } else {
                        req.role = tokenData.role;
                        req.user = tokenData.user;
                    }

                    if (req.params && req.params.user === 'me' && /^[0-9a-f]{24}$/i.test(req.user)) {
                        req.params.user = req.user;
                    }

                    if (!req.role) {
                        return fail();
                    }

                    if (/^[0-9a-f]{24}$/i.test(req.user)) {
                        let tokenAuthVersion = Number(tokenData.authVersion) || 0;
                        let userData = await db.users.collection('users').findOne(
                            {
                                _id: new ObjectID(req.user)
                            },
                            { projection: { authVersion: true } }
                        );
                        let userAuthVersion = Number(userData && userData.authVersion) || 0;
                        if (!userData || tokenAuthVersion < userAuthVersion) {
                            // unknown user or expired session
                            try {
                                /*
                                // do not delete just in case there is something wrong with the check
                                await db.redis
                                    .multi()
                                    .del('tn:token:' + tokenHash)
                                    .exec();
                                */
                            } catch (err) {
                                // ignore
                            }
                            return fail();
                        }
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

    const component = config.log.gelf.component || 'wildduck';
    const hostname = config.log.gelf.hostname || os.hostname();
    const gelf =
        config.log.gelf && config.log.gelf.enabled
            ? new Gelf(config.log.gelf.options)
            : {
                // placeholder
                emit: (key, message) => log.info('Gelf', JSON.stringify(message))
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
        authlogExpireDays: config.log.authlogExpireDays,
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

    server.loggelf = message => loggelf(message);

    usersRoutes(db, server, userHandler);
    teamsRoutes(db, server, userHandler);
    addressesRoutes(db, server, userHandler);
    mailboxesRoutes(db, server, mailboxHandler);
    messagesRoutes(db, server, messageHandler, userHandler, storageHandler);
    storageRoutes(db, server, storageHandler);
    filtersRoutes(db, server);
    aspsRoutes(db, server, userHandler);
    totpRoutes(db, server, userHandler);
    custom2faRoutes(db, server, userHandler);
    u2fRoutes(db, server, userHandler);
    updatesRoutes(db, server, notifier);
    authRoutes(db, server, userHandler);
    autoreplyRoutes(db, server);
    submitRoutes(db, server, messageHandler, userHandler);
    auditRoutes(db, server, auditHandler);
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
