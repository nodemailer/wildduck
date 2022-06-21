'use strict';

const config = require('wild-config');
const log = require('npmlog');
const PluginHandler = require('zone-mta/lib/plugin-handler');
const db = require('./db');

module.exports.handler = false;

module.exports.init = context => {
    module.exports.handler = new PluginHandler({
        logger: log,
        pluginsPath: config.plugins.pluginsPath,
        plugins: config.plugins.conf,
        context,
        log: config.log,
        db
    });
};
