/* eslint global-require: 0, no-console: 0 */
'use strict';

const config = require('wild-config');
const Gelf = require('gelf');
const os = require('os');

let bugsnag;
let gelf;
let loggelf;
let component;
let hostname;

module.exports.gelf = {};

if (config.bugsnagCode) {
    bugsnag = require('bugsnag');
    bugsnag.register(config.bugsnagCode);
} else if (config.log && config.log.gelf && config.log.gelf.enabled) {
    component = config.log.gelf.component || 'wildduck';
    hostname = config.log.gelf.hostname || os.hostname();
    module.exports.gelf.handler =
        config.log.gelf && config.log.gelf.enabled
            ? new Gelf(config.log.gelf.options)
            : {
                  // placeholder
                  emit: () => false
              };

    loggelf = (...args) => {
        let err = args.shift() || {};
        if (err.code === 'ECONNRESET') {
            // just ignore
            return;
        }

        let message = {
            short_message: component.toUpperCase() + ' [Exception] ' + (err.message || ''),
            full_message: err.stack,
            _exception: 'yes',
            _error: err.message
        };

        Object.keys(err).forEach(key => {
            let vKey = '_' + key;
            if (!message[vKey] && typeof err[key] !== 'object') {
                message[vKey] = (err[key] || '').toString().trim();
            }
        });

        for (let extra of args) {
            Object.keys(extra || {}).forEach(key => {
                let vKey = '_' + key;
                if (!message[vKey] && typeof extra[key] !== 'object') {
                    message[vKey] = (extra[key] || '').toString().trim();
                }
            });
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
        module.exports.gelf.handler.emit('gelf.log', message);
    };
}

module.exports.notify = (...args) => {
    if (bugsnag) {
        bugsnag.notify(...args);
    } else if (gelf) {
        loggelf(...args);
    } else {
        console.error(...args);
    }
};

module.exports.notifyConnection = (connection, ...args) => {
    let err = args[0];
    let metaData = args[1] || {};

    if (connection) {
        if (connection.selected) {
            metaData.selected = connection.selected.mailbox;
        }

        if (connection.session.user) {
            metaData.userId = connection.session.user.id.toString();
        }

        metaData.remoteAddress = connection.session.remoteAddress;
        metaData.isUTF8Enabled = !!connection.acceptUTF8Enabled;
    }

    Object.keys(err.meta || {}).forEach(key => {
        metaData[key] = err.meta[key];
    });

    args[1] = metaData;

    if (bugsnag) {
        bugsnag.notify(...args);
    } else if (gelf) {
        loggelf(...args);
    } else {
        console.error(...args);
    }
};

module.exports.intercept = (...args) => {
    if (bugsnag) {
        return bugsnag.intercept(...args);
    }
    let cb;
    if (args.length) {
        cb = args[args.length - 1];
        if (typeof cb === 'function') {
            args[args.length - 1] = function(...rArgs) {
                if (rArgs.length > 1 && rArgs[0]) {
                    console.error(rArgs[0]);
                }
                return cb(...rArgs);
            };
        }
    }
};

module.exports.setGelf = gelf => {
    module.exports.gelf.handler = gelf;
};
