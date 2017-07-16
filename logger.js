'use strict';

const config = require('wild-config');
const log = require('npmlog');

let syslog;
try {
    // might not be installed
    syslog = require('modern-syslog'); // eslint-disable-line global-require
} catch (E) {
    // just ignore
}

if (config.log.syslog && syslog) {
    syslog.open(config.ident, syslog.option.LOG_PID, syslog.level.LOG_INFO);

    let logger = data => {
        data.messageRaw[0] = '(' + data.prefix + ') ' + data.messageRaw[0];
        return data.messageRaw;
    };

    switch (log.level) {
        /* eslint-disable no-fallthrough */
        case 'silly':
            log.on('log.silly', data => syslog.debug(...logger(data)));
        case 'verbose':
            log.on('log.verbose', data => syslog.info(...logger(data)));
        case 'info':
            log.on('log.info', data => syslog.notice(...logger(data)));
        case 'http':
            log.on('log.http', data => syslog.note(...logger(data)));
        case 'warn':
            log.on('log.warn', data => syslog.warn(...logger(data)));
        case 'error':
            log.on('log.error', data => syslog.error(...logger(data)));
        /* eslint-enable no-fallthrough */
    }

    log.level = 'silent'; // disable normal log stream
}
