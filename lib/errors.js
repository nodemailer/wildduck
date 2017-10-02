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
