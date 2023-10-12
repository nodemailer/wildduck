'use strict';

const config = require('wild-config');
const restify = require('restify');
const log = require('npmlog');
const logger = require('restify-logger');
const corsMiddleware = require('restify-cors-middleware2');
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
const ObjectId = require('mongodb').ObjectId;
const tls = require('tls');
const Lock = require('ioredfour');
const Path = require('path');
const errors = require('restify-errors');

const acmeRoutes = require('./lib/api/acme');
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
const webauthnRoutes = require('./lib/api/2fa/webauthn');
const updatesRoutes = require('./lib/api/updates');
const authRoutes = require('./lib/api/auth');
const autoreplyRoutes = require('./lib/api/autoreply');
const submitRoutes = require('./lib/api/submit');
const auditRoutes = require('./lib/api/audit');
const domainaliasRoutes = require('./lib/api/domainaliases');
const dkimRoutes = require('./lib/api/dkim');
const certsRoutes = require('./lib/api/certs');
const webhooksRoutes = require('./lib/api/webhooks');
const settingsRoutes = require('./lib/api/settings');
const { SettingsHandler } = require('./lib/settings-handler');
const fs = require('fs');
const yaml = require('js-yaml');

let userHandler;
let mailboxHandler;
let messageHandler;
let storageHandler;
let auditHandler;
let settingsHandler;
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

                _ip: ((req.params && req.params.ip) || '').toString().substr(0, 40) || '',
                _sess: ((req.params && req.params.sess) || '').toString().substr(0, 40) || '',

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
    let httpsServerOptions = {};

    httpsServerOptions.key = certOptions.key;
    httpsServerOptions.cert = tools.buildCertChain(certOptions.cert, certOptions.ca);

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

    serverOptions.httpsServerOptions = httpsServerOptions;
}

const server = restify.createServer(serverOptions);

const cors = corsMiddleware({
    origins: [].concat(config.api.cors.origins || ['*']),
    allowHeaders: ['X-Access-Token', 'Authorization'],
    allowCredentialsAllOrigins: true
});

server.pre(cors.preflight);
server.use(cors.actual);

// disable compression for EventSource response
// this needs to be called before gzipResponse
server.use(async (req, res) => {
    if (res && req.route.path === '/users/:user/updates') {
        req.headers['accept-encoding'] = '';
    }
});

server.use(
    restify.plugins.queryParser({
        allowDots: true,
        mapParams: true
    })
);
server.use(
    restify.plugins.bodyParser({
        maxBodySize: 0,
        mapParams: true,
        mapFiles: true,
        overrideParams: false
    })
);

// public files
server.get(
    { name: 'public_get', path: '/public/*' },
    restify.plugins.serveStatic({
        directory: Path.join(__dirname, 'public'),
        default: 'index.html'
    })
);

// Disable GZIP as it does not work with stream.pipe(res)
//server.use(restify.plugins.gzipResponse());

server.use(async (req, res) => {
    if (['public_get', 'public_post', 'acmeToken'].includes(req.route.name)) {
        // skip token check for public pages
        return;
    }

    let accessToken =
        req.query.accessToken ||
        req.headers['x-access-token'] ||
        (req.headers.authorization ? req.headers.authorization.replace(/^Bearer\s+/i, '').trim() : false) ||
        false;

    if (req.query.accessToken) {
        // delete or it will conflict with Joi schemes
        delete req.query.accessToken;
    }

    if (req.params.accessToken) {
        // delete or it will conflict with Joi schemes
        delete req.params.accessToken;
    }

    if (req.headers['x-access-token']) {
        req.headers['x-access-token'] = '';
    }

    if (req.headers.authorization) {
        req.headers.authorization = '';
    }

    let tokenRequired = false;

    let fail = () => {
        let error = new errors.ForbiddenError(
            {
                code: 'InvalidToken'
            },
            'Invalid accessToken value'
        );
        throw error;
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
            return;
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
                            _id: new ObjectId(req.user)
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

                // pass
                return;
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
});

logger.token('user-ip', req => ((req.params && req.params.ip) || '').toString().substr(0, 40) || '-');
logger.token('user-sess', req => (req.params && req.params.sess) || '-');

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

    server.loggelf = message => loggelf(message);

    server.lock = new Lock({
        redis: db.redis,
        namespace: 'mail'
    });

    acmeRoutes(db, server, { disableRedirect: true });
    usersRoutes(db, server, userHandler, settingsHandler);
    addressesRoutes(db, server, userHandler, settingsHandler);
    mailboxesRoutes(db, server, mailboxHandler);
    messagesRoutes(db, server, messageHandler, userHandler, storageHandler, settingsHandler);
    storageRoutes(db, server, storageHandler);
    filtersRoutes(db, server, userHandler, settingsHandler);
    domainaccessRoutes(db, server);
    aspsRoutes(db, server, userHandler);
    totpRoutes(db, server, userHandler);
    custom2faRoutes(db, server, userHandler);
    webauthnRoutes(db, server, userHandler);
    updatesRoutes(db, server, notifier);
    authRoutes(db, server, userHandler);
    autoreplyRoutes(db, server);
    submitRoutes(db, server, messageHandler, userHandler, settingsHandler);
    auditRoutes(db, server, auditHandler);
    domainaliasRoutes(db, server);
    dkimRoutes(db, server);
    certsRoutes(db, server);
    webhooksRoutes(db, server);
    settingsRoutes(db, server, settingsHandler);

    if (process.env.NODE_ENV === 'test') {
        server.get(
            { name: 'api-methods', path: '/api-methods' },
            tools.responseWrapper(async (req, res) => {
                res.charSet('utf-8');

                return res.json(server.router.getRoutes());
            })
        );
    }

    server.get(
        { path: '/openapi', name: 'openapi-docs-generation' },
        tools.responseWrapper(async (req, res) => {
            res.charSet('utf-8');

            let docs = `
openapi: 3.0.0
info:
    title: WildDuck API
    description: WildDuck API docs
    version: 1.0.0
    contact:
        url: 'https://github.com/nodemailer/wildduck'

servers:
    - url: 'https://api.wildduck.email'

tags:
    - name: Addresses
    - name: ApplicationPasswords
    - name: Archive
      description: Archive includes all deleted messages. Once messages are old enough then these are permanenetly deleted from the archive as well. Until then you can restore the deleted messages.
    - name: Audit
      description: 'Auditing allows to monitor an email account. All existing, deleted and new emails are copied to the auditing system. See also https://github.com/nodemailer/wildduck-audit-manager'
    - name: Authentication
    - name: Autoreplies
    - name: Certs
      description: WildDuck allows to register TLS certificates to be used with SNI connections. These certificates are used by IMAP, POP3, API and SMTP servers when a SNI capable client establishes a TLS connection. This does not apply for MX servers.
    - name: DKIM
      description: Whenever an email is sent WildDuck checks if there is a DKIM key registered for the domain name of the sender address and uses it to sign the message.
    - name: DomainAccess
      description: Add sender domain names to allowlist (messages are all accepted) or blocklist (messages are sent to Spam folder)
    - name: DomainAliases
    - name: Filters
    - name: Mailboxes
    - name: Messages
    - name: Settings
    - name: Storage
      description: Storage allows easier attachment handling when composing Draft messages. Instead of uploading the attachmnent with every draft update, you store the attachment to the Storage and then link stored file for the Draft.
    - name: Submission
    - name: TwoFactorAuth
    - name: Users
    - name: Webhooks\n`;
            const mapPathToMethods = {}; // map -> {path -> {post -> {}, put -> {}, delete -> {}, get -> {}}}

            const routes = server.router.getRoutes();
            for (const routePath in routes) {
                const route = routes[routePath];
                const { spec } = route;

                if (!spec.include) {
                    continue;
                }

                if (!mapPathToMethods[spec.path]) {
                    mapPathToMethods[spec.path] = {};
                }

                mapPathToMethods[spec.path][spec.method.toLowerCase()] = {};
                const methodObj = mapPathToMethods[spec.path][spec.method.toLowerCase()];
                // 1) add tags
                methodObj.tags = spec.tags;

                // 2) add summary
                methodObj.summary = spec.summary || '';

                // 3) add description
                methodObj.description = spec.description || '';

                // 4) add operationId
                methodObj.operationId = spec.name || route.name;

                // 5) add requestBody
                const applicationType = spec.applicationType || 'application/json';
                methodObj.requestBody = {
                    content: {
                        [applicationType]: {
                            schema: {
                                type: 'object',
                                properties: {}
                            }
                        }
                    },
                    required: true
                };

                for (const reqBodyKey in spec.requestBody) {
                    const reqBodyKeyData = spec.requestBody[reqBodyKey];

                    parseJoiObject(reqBodyKey, reqBodyKeyData, methodObj.requestBody.content[applicationType].schema.properties);
                }

                // 6) add parameters (queryParams + pathParams).
                methodObj.parameters = {};
                for (const paramKey in spec.pathParams) {
                    const paramKeyData = spec.pathParams[paramKey];

                    methodObj.parameters[paramKey] = {};
                    const obj = methodObj.parameters[paramKey];
                    obj.in = 'path';
                    obj.description = paramKeyData._flags.description || '';
                    obj.required = paramKeyData._flags.presence === 'required';
                    obj.schema = { type: paramKeyData.type };
                }

                for (const paramKey in spec.queryParams) {
                    const paramKeyData = spec.queryParams[paramKey];

                    methodObj.parameters[paramKey] = {};
                    const obj = methodObj.parameters[paramKey];
                    obj.in = 'query';
                    obj.description = paramKeyData._flags.description || '';
                    obj.required = paramKeyData._flags.presence === 'required';
                    obj.schema = { type: paramKeyData.type };
                }

                // 7) add responses
                methodObj.responses = {};

                for (const resHttpCode in spec.response) {
                    const restBodyData = spec.response[resHttpCode];

                    parseJoiObject(resHttpCode, restBodyData, methodObj.responses);
                }
            }

            const components = { components: { schemas: {} } };

            for (const path in mapPathToMethods) {
                // for every path
                const pathData = mapPathToMethods[path];

                for (const httpMethod in pathData) {
                    // for every http method (post, put, get, delete)
                    const innerData = pathData[httpMethod];

                    // for every requestBody obj
                    for (const key in innerData.requestBody.content[Object.keys(innerData.requestBody.content)[0]].schema.properties) {
                        const reqBodyData = innerData.requestBody.content[Object.keys(innerData.requestBody.content)[0]].schema.properties[key];

                        parseComponetsDecoupled(reqBodyData, components.components.schemas);
                        replaceWithRefs(reqBodyData);
                    }

                    // for every response object
                    for (const key in innerData.responses) {
                        // key here is http method (2xx, 4xx, 5xx)
                        const obj = innerData.responses[key];
                        parseComponetsDecoupled(obj, components.components.schemas);
                        replaceWithRefs(obj);
                    }
                }
            }

            // refify components that use other components
            for (const obj of Object.values(components.components.schemas)) {
                replaceWithRefs(obj);
            }

            const finalObj = { paths: mapPathToMethods };

            const mapPathToMethodsYaml = yaml.dump(finalObj, { indent: 4, lineWidth: -1, noRefs: true });
            const componentsYaml = yaml.dump(components, { indent: 4, lineWidth: -1, noRefs: true });

            docs += mapPathToMethodsYaml;
            docs += componentsYaml;

            docs += `
    securitySchemes:
        AccessTokenAuth:
            name: X-Access-Token
            type: apiKey
            in: header
            description: |-
                If authentication is enabled in the WildDuck configuration, you will need to supply an access token in the \`X-Access-Token\` header.

                \`\`\`json
                {
                    "X-Access-Token": "59fc66a03e54454869460e45"
                }
                \`\`\`
security:
    - AccessTokenAuth: []
`;

            await fs.promises.writeFile(__dirname + '/openapidocs.yml', docs);
        })
    );

    // ignore function and symbol types
    const joiTypeToOpenApiTypeMap = {
        any: 'object',
        number: 'number',
        link: 'string',
        boolean: 'boolean',
        date: 'string',
        string: 'string',
        binary: 'string'
    };

    function replaceWithRefs(reqBodyData) {
        if (reqBodyData.type === 'array') {
            const obj = reqBodyData.items[0];

            replaceWithRefs(obj);
        } else if (reqBodyData.type === 'object') {
            if (reqBodyData.objectName) {
                const objectName = reqBodyData.objectName;
                Object.keys(reqBodyData).forEach(key => {
                    if (key !== '$ref') {
                        delete reqBodyData[key];
                    }
                });
                reqBodyData.$ref = `#/components/schemas/${objectName}`;
            } else {
                for (const key in reqBodyData.properties) {
                    replaceWithRefs(reqBodyData.properties[key]);
                }
            }
        } else if (reqBodyData.type === 'alternatives') {
            for (const obj in reqBodyData.oneOf) {
                replaceWithRefs(obj);
            }
        }
    }

    function parseComponetsDecoupled(component, components) {
        if (component.type === 'array') {
            const obj = structuredClone(component.items[0]); // copy

            if (obj.objectName) {
                for (const key in obj.properties) {
                    parseComponetsDecoupled(obj.properties[key], components);
                }

                // in case the Array itself is marked as a separate object >
                const objectName = obj.objectName;
                components[objectName] = obj;
                delete components[objectName].objectName;
                // ^
            }
        } else if (component.type === 'object') {
            const obj = structuredClone(component); // copy
            const objectName = obj.objectName;

            for (const key in obj.properties) {
                parseComponetsDecoupled(obj.properties[key], components);
            }

            if (objectName) {
                components[objectName] = obj;
                delete components[objectName].objectName;
            }
        } else if (component.oneOf) {
            // Joi object is of 'alternatives' types
            for (const obj in component.oneOf) {
                parseComponetsDecoupled({ ...obj }, components);
            }
        }
    }

    /**
     * Parse Joi Objects
     */
    function parseJoiObject(path, joiObject, requestBodyProperties) {
        if (joiObject.type === 'object') {
            const fieldsMap = joiObject._ids._byKey;

            const data = {
                type: joiObject.type,
                description: joiObject._flags.description || '',
                properties: {},
                required: []
            };

            if (joiObject._flags.objectName) {
                data.objectName = joiObject._flags.objectName;
            }

            if (path) {
                requestBodyProperties[path] = data;
            } else {
                requestBodyProperties.push(data);
            }

            for (const [key, value] of fieldsMap) {
                if (value.schema._flags.presence === 'required') {
                    data.required.push(key);
                }
                parseJoiObject(key, value.schema, data.properties);
            }
        } else if (joiObject.type === 'alternatives') {
            const matches = joiObject.$_terms.matches;

            const data = {
                oneOf: [],
                description: joiObject._flags.description || ''
            };

            if (path) {
                requestBodyProperties[path] = data;
            } else {
                requestBodyProperties.push(data);
            }

            for (const alternative of matches) {
                parseJoiObject(null, alternative.schema, data.oneOf);
            }
        } else if (joiObject.type === 'array') {
            const elems = joiObject?.$_terms.items;

            const data = {
                type: 'array',
                items: [],
                description: joiObject._flags.description || ''
            };

            if (path) {
                requestBodyProperties[path] = data;
            } else {
                requestBodyProperties.push(data);
            }
            parseJoiObject(null, elems[0], data.items);
        } else {
            const openApiType = joiTypeToOpenApiTypeMap[joiObject.type]; // even if type is object here then ignore and do not go recursive
            const isRequired = joiObject._flags.presence === 'required';
            const description = joiObject._flags.description || '';
            let format = undefined;

            if (!openApiType) {
                throw new Error('Unsupported type! Check API endpoint!');
            }

            if (joiObject.type !== openApiType) {
                // type has changed, so probably string, acquire format
                format = joiObject.type;
            }

            const data = { type: openApiType, description, required: isRequired };
            if (format) {
                data.format = format;
            }
            if (path) {
                requestBodyProperties[path] = data;
            } else {
                requestBodyProperties.push(data);
            }
        }
    }

    server.on('error', err => {
        if (!started) {
            started = true;
            return done(err);
        }
        log.error('API', err);
    });

    server.on('restifyError', (req, res, err, callback) => {
        if (!started) {
            started = true;
            return done(err);
        }
        return callback();
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
