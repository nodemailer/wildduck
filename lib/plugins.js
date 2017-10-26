'use strict';

const config = require('wild-config');
const pathlib = require('path');
const log = require('npmlog');
const db = require('./db');

const WD_PATH = pathlib.join(__dirname, '..');
const CONFIG_PATH = config.configDirectory || WD_PATH;

const hooks = new Map();

class PluginInstance {
    constructor(key, config) {
        this.db = db;

        this.key = key;
        this.config = config || {};

        this.logger = {};
        ['silly', 'verbose', 'info', 'http', 'warn', 'error', 'debug', 'err'].forEach(level => {
            this.logger[level] = (...args) => {
                switch (level) {
                    case 'debug':
                        level = 'verbose';
                        break;
                    case 'err':
                        level = 'error';
                        break;
                }
                log[level]('[' + key + ']', ...args);
            };
        });
    }

    addHook(hook, handler) {
        hook = (hook || '')
            .toString()
            .replace(/\s+/g, '')
            .toLowerCase();
        if (!hook) {
            return;
        }
        if (!hooks.has(hook)) {
            hooks.set(hook, []);
        }
        hooks.get(hook).push({ plugin: this, handler });
    }

    init(done) {
        if (!this.config.path) {
            this.logger.debug('Plugin path not provided, skipping');
            return setImmediate(done);
        }
        try {
            let pluginPath = this.config.path.replace(/\$WD/g, WD_PATH).replace(/\$CONFIG/g, CONFIG_PATH);
            this.module = require(pluginPath); //eslint-disable-line global-require
        } catch (E) {
            this.logger.error('Failed to load plugin. %s', E.message);
            return setImmediate(done);
        }

        if (typeof this.module.init !== 'function') {
            this.logger.debug('Init method not found');
            return setImmediate(done);
        }

        try {
            return this.module.init(this, err => {
                if (err) {
                    this.logger.error('Initialization resulted with an error. %s', err.message);
                } else {
                    this.logger.debug('Plugin "%s" initialized', this.module.title || this.key);
                }
                return setImmediate(done);
            });
        } catch (E) {
            this.logger.error('Failed executing init method. %s', E.message);
            return setImmediate(done);
        }
    }
}

module.exports.init = next => {
    let keys = Object.keys(config.plugins || {});

    let pos = 0;
    let loadNextPlugin = () => {
        if (pos >= keys.length) {
            return setImmediate(next);
        }
        let key = keys[pos++];
        if (!config.plugins[key].enabled) {
            return setImmediate(loadNextPlugin);
        }
        let plugin = new PluginInstance(key, config.plugins[key]);
        plugin.init(loadNextPlugin);
    };
    setImmediate(loadNextPlugin);
};

module.exports.runHooks = (hook, ...args) => {
    let next = args.pop();

    hook = (hook || '')
        .toString()
        .replace(/\s+/g, '')
        .toLowerCase();

    if (!hook || !hooks.has(hook)) {
        return setImmediate(next);
    }

    let handlers = hooks.get(hook);
    let pos = 0;
    let processHandler = () => {
        if (pos >= handlers.length) {
            return setImmediate(next);
        }
        let entry = handlers[pos++];
        let returned = false;
        try {
            entry.handler(...args, err => {
                if (returned) {
                    return;
                }
                returned = true;

                if (err) {
                    entry.plugin.logger.error('Failed processing hook %s. %s', hook, err.message);
                }
                setImmediate(processHandler);
            });
        } catch (E) {
            if (returned) {
                return;
            }
            returned = true;
            entry.plugin.logger.error('Failed processing hook %s. %s', hook, E.message);
            setImmediate(processHandler);
        }
    };
    setImmediate(processHandler);
};
