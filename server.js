/* eslint global-require:0 */

'use strict';

process.env.UV_THREADPOOL_SIZE = 16;

const config = require('wild-config');
const pino = require('pino');

const logger = pino().child({
    process: 'server'
});

if (process.env.NODE_CONFIG_ONLY === 'true') {
    logger.info(config);
    return process.exit();
}

const errors = require('./lib/errors');
const os = require('os');
const packageData = require('./package.json');

const printLogo = () => {
    logger.info({
        app: packageData.name,
        version: packageData.version
    });
};

let processCount = config.processes;
if (processCount) {
    if (/^\s*cpus\s*$/i.test(processCount)) {
        processCount = os.cpus().length;
    }

    if (typeof processCount !== 'number' && !isNaN(processCount)) {
        processCount = Number(processCount);
    }

    if (isNaN(processCount)) {
        processCount = 1;
    }
}

if (!processCount || processCount <= 1) {
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

        logger.info({ msg: `Master process is running`, pid: process.pid });

        let workers = new Set();

        let forkWorker = () => {
            let worker = cluster.fork();
            workers.add(worker);
            logger.info({ msg: `Forked worker`, pid: worker.process.pid });
        };

        // Fork workers.
        for (let i = 0; i < processCount; i++) {
            forkWorker();
        }

        cluster.on('exit', worker => {
            logger.info({ msg: `Worker died`, pid: worker.process.pid });
            workers.delete(worker);
            setTimeout(forkWorker, 1000);
        });

        config.on('reload', () => {
            workers.forEach(child => {
                try {
                    child.kill('SIGHUP');
                } catch (E) {
                    //ignore
                }
            });
        });
    } else {
        if (config.ident) {
            process.title = config.ident + ' worker';
        }

        require('./worker.js');
    }
}

process.on('unhandledRejection', err => {
    logger.error({ msg: 'Unhandled rejection', err });
    errors.notify(err);
});
