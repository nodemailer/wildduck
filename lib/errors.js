/* eslint global-require: 0 */
'use strict';

const config = require('wild-config');
let bugsnag;

if (config.bugsnagCode) {
    bugsnag = require('bugsnag');
    bugsnag.register(config.bugsnagCode);
    bugsnag.notify(new Error('Non-fatal'));
}

module.exports.notify = (...args) => {
    if (bugsnag) {
        bugsnag.notify(...args);
    }
};
