'use strict';

const config = require('wild-config');
const maildrop = require('./maildrop');
const db = require('./db');

module.exports = (options, callback) => {
    if (!config.sender.enabled) {
        return callback(null, false);
    }

    let message = maildrop(
        {
            parentId: options.parentId,
            reason: 'forward',

            from: options.sender,
            to: options.recipient,

            forward: options.forward,
            http: !!options.targetUrl,
            targeUrl: options.targetUrl,

            interface: 'forwarder'
        },
        (err, ...args) => {
            if (err || !args[0]) {
                return callback(err, ...args);
            }
            db.database.collection('messagelog').insertOne({
                id: args[0],
                action: 'FORWARD',
                parentId: options.parentId,
                from: options.sender,
                to: options.recipient,
                forward: options.forward,
                http: !!options.targetUrl,
                targeUrl: options.targetUrl,
                created: new Date()
            }, () => callback(err, ...args));
        }
    );

    setImmediate(() => {
        let pos = 0;
        let writeNextChunk = () => {
            if (pos >= options.chunks.length) {
                return message.end();
            }
            let chunk = options.chunks[pos++];
            if (!message.write(chunk)) {
                return message.once('drain', writeNextChunk);
            } else {
                setImmediate(writeNextChunk);
            }
        };
        setImmediate(writeNextChunk);
    });
};
