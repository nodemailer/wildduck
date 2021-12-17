'use strict';

const config = require('wild-config');
const db = require('./lib/db');
const Gelf = require('gelf');
const os = require('os');

const pino = require('pino');
const Hapi = require('@hapi/hapi');
const hapiPino = require('hapi-pino');

const acmeRoutes = require('./lib/api/acme');

const REDACTED_KEYS = ['req.headers.authorization', 'req.headers["x-access-token"]', 'req.headers.cookie'];

const logger = pino({ redact: REDACTED_KEYS }).child({
    process: 'acme'
});

const serverOptions = {
    port: config.acme.agent.port,
    host: config.acme.agent.host,

    routes: {
        cors: {
            origin: ['*'],
            additionalHeaders: ['X-Access-Token'],
            credentials: true
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

let loggelf = message => {
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
    if (!config.acme.agent.enabled) {
        return false;
    }

    const server = Hapi.server(serverOptions);

    await server.register({
        plugin: hapiPino,
        options: {
            //getChildBindings: request => ({ req: request }),
            instance: logger.child({ provider: 'hapi' }),
            // Redact Authorization headers, see https://getpino.io/#/docs/redaction
            redact: REDACTED_KEYS
        },

        router: {
            stripTrailingSlash: true
        }
    });

    server.decorate('server', 'loggelf', loggelf);

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

        request.logger.error({ msg: 'Request error', error });

        return h.response(request.errorInfo).code(request.errorInfo.statusCode || 500);
    });

    acmeRoutes(server, db);

    // Not found, redirect by default
    server.route({
        method: '*',
        path: '/{any*}',
        async handler(request, h) {
            return h.redirect(config.acme.agent.redirect);
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
