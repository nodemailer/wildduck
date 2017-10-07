/* eslint global-require: 0, no-console: 0 */
'use strict';

const config = require('wild-config');
let bugsnag;

if (config.bugsnagCode) {
    bugsnag = require('bugsnag');
    bugsnag.register(config.bugsnagCode);
}

module.exports.notify = (...args) => {
    if (bugsnag) {
        bugsnag.notify(...args);
    } else {
        console.error(...args);
    }
};

module.exports.notifyConnection = (connection, ...args) => {
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

    args[1] = metaData;

    if (bugsnag) {
        bugsnag.notify(...args);
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
