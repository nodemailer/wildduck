/* eslint global-require:0 */

'use strict';

process.env.UV_THREADPOOL_SIZE = 16;

const config = require('wild-config');
const errors = require('./lib/errors');
const fs = require('fs');
const log = require('npmlog');
const packageData = require('./package.json');

log.level = config.log.level;
require('./logger');

errors.notify(new Error('Starting mail server application'));

const printLogo = () => {
    let logo = fs
        .readFileSync(__dirname + '/logo.txt', 'utf-8')
        .replace(/^\n+|\n+$/g, '')
        .split('\n');

    let columnLength = logo.map(l => l.length).reduce((max, val) => (val > max ? val : max), 0);
    let versionString = ' ' + packageData.name + '@' + packageData.version + ' ';
    let versionPrefix = '-'.repeat(Math.round(columnLength / 2 - versionString.length / 2));
    let versionSuffix = '-'.repeat(columnLength - versionPrefix.length - versionString.length);

    log.info('App', ' ' + '-'.repeat(columnLength));
    log.info('App', '');

    logo.forEach(line => {
        log.info('App', ' ' + line);
    });

    log.info('App', '');

    log.info('App', ' ' + versionPrefix + versionString + versionSuffix);
    log.info('App', '');
};

if (!config.processes || config.processes <= 1) {
    printLogo();
    if (config.ident) {
        process.title = config.ident;
    }
    // single process mode, do not fork anything
    require('./worker.js');
} else {
    let cluster = require('cluster');

    if (cluster.isMaster) {
        printLogo();

        if (config.ident) {
            process.title = config.ident + ' master';
        }

        log.info('App', `Master [${process.pid}] is running`);

        let forkWorker = () => {
            let worker = cluster.fork();
            log.info('App', `Forked worker ${worker.process.pid}`);
        };

        // Fork workers.
        for (let i = 0; i < config.processes; i++) {
            forkWorker();
        }

        cluster.on('exit', worker => {
            log.info('App', `Worker ${worker.process.pid} died`);
            setTimeout(forkWorker, 1000);
        });
    } else {
        if (config.ident) {
            process.title = config.ident + ' worker';
        }

        require('./worker.js');
    }
}

process.on('unhandledRejection', err => {
    log.error('App', 'Unhandled rejection: %s' + ((err && err.stack) || err));
    errors.notify(err);
});
