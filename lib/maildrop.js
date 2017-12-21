'use strict';

const config = require('wild-config');
const db = require('./db');
const Maildropper = require('./Maildropper');

let maildropper;

module.exports = (options, callback) => {
    if (!config.sender.enabled) {
        setImmediate(() => callback(null, false));
        return false;
    }

    maildropper =
        maildropper ||
        new Maildropper({
            db,
            enabled: config.sender.enabled,
            zone: config.sender.zone,
            collection: config.sender.collection,
            gfs: config.sender.gfs
        });

    maildropper.push(options, callback);
};
