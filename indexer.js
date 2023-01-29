'use strict';

const log = require('npmlog');
const config = require('wild-config');
const Gelf = require('gelf');
const os = require('os');
const Queue = require('bull');

let loggelf;

module.exports.start = callback => {
    if (!config.elasticsearch || !config.elasticsearch.indexer || !config.elasticsearch.indexer.enabled) {
        return setImmediate(() => callback(null, false));
    }

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
        try {
            gelf.emit('gelf.log', message);
        } catch (err) {
            log.error('Gelf', err);
        }
    };

    const indexingQueue = new Queue('indexing', typeof config.dbs.redis === 'object' ? { redis: config.dbs.redis } : config.dbs.redis);

    indexingQueue.process(async job => {
        try {
            if (!job || !job.data || !job.data.ev) {
                return false;
            }
            const data = job.data;
            console.log('DATA FOR INDEXING', data);

            loggelf({ _msg: 'hellow world' });
        } catch (err) {
            log.error('Indexing', err);
            throw err;
        }
    });

    callback();
};
