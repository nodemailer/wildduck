'use strict';

const log = require('npmlog');
const config = require('wild-config');
const Gelf = require('gelf');
const os = require('os');
const Queue = require('bull');
const db = require('./lib/db');
const { ObjectID } = require('mongodb');
const axios = require('axios');

let loggelf;

async function postWebhook(webhook, data) {
    let res = await axios.post(webhook.url, data);
    if (!res) {
        throw new Error(`Failed to POST request to ${webhook.url}`);
    }

    log.verbose('Webhooks', 'Posted %s to %s with status %s', data.ev, webhook.url, res.status);

    if (res.status === 410) {
        // autodelete
        try {
            await db.users.collection('webhooks').deleteOne({
                _id: new ObjectID(webhook._id)
            });
        } catch (err) {
            // ignore
        }
        return;
    }

    if (!res.status || res.status < 200 || res.status >= 300) {
        throw new Error(`Invalid response status ${res.status}`);
    }

    return true;
}

module.exports.start = callback => {
    if (!config.webhooks.enabled) {
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

    const webhooksQueue = new Queue('webhooks', { redis: config.dbs.redis });
    const webhooksPostQueue = new Queue('webhooks_post', { redis: config.dbs.redis });

    webhooksQueue.process(async job => {
        try {
            if (!job || !job.data || !job.data.ev) {
                return false;
            }

            const data = job.data;

            let evtList = ['*'];
            let typeParts = data.ev.split('.');
            typeParts.pop();
            for (let i = 1; i <= typeParts.length; i++) {
                evtList.push(typeParts.slice(0, i) + '.*');
            }
            evtList.push(data.ev);

            const query = { type: { $in: evtList } };
            if (data.user) {
                query.user = { $in: [new ObjectID(data.user), null] };
            }

            let webhooks = await db.database.collection('webhooks').find(query).toArray();
            for (let webhook of webhooks) {
                try {
                    let job = await webhooksPostQueue.add(
                        { data, webhook },
                        {
                            removeOnComplete: true,
                            removeOnFail: 500,
                            attempts: 5,
                            backoff: {
                                type: 'exponential',
                                delay: 2000
                            }
                        }
                    );
                    return job;
                } catch (err) {
                    // ignore?
                    log.error('Events', err);
                }
            }
        } catch (err) {
            log.error('Webhooks', err);
            throw err;
        }
    });

    webhooksPostQueue.process(async job => {
        if (!job || !job.data) {
            return false;
        }
        const { data, webhook } = job.data;
        return await postWebhook(webhook, data);
    });

    callback();
};
