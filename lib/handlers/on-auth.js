'use strict';

const config = require('wild-config');

module.exports = (server, userHandler, userCache) => (login, session, callback) => {
    let username = (login.username || '').toString().trim();

    userHandler.authenticate(
        username,
        login.password,
        'imap',
        {
            protocol: 'IMAP',
            sess: session.id,
            ip: session.remoteAddress
        },
        (err, result) => {
            if (err) {
                return callback(err);
            }
            if (!result) {
                return callback();
            }

            if (result.scope === 'master' && result.require2fa) {
                // master password not allowed if 2fa is enabled!
                return callback();
            }

            let checkConnectionLimits = next => {
                if (typeof server.notifier.allocateConnection === 'function') {
                    return userCache.get(result.user, 'imapMaxConnections', config.imap.maxConnections || 15, (err, limit) => {
                        if (err) {
                            return callback(err);
                        }
                        server.notifier.allocateConnection(
                            {
                                service: 'imap',
                                session,
                                user: result.user,
                                limit
                            },
                            next
                        );
                    });
                }

                return next(null, true);
            };

            checkConnectionLimits((err, success) => {
                if (err) {
                    return callback(err);
                }

                if (!success) {
                    err = new Error('[ALERT] Too many simultaneous connections.');
                    err.response = 'NO';
                    return callback(err);
                }

                callback(null, {
                    user: {
                        id: result.user,
                        username: result.username
                    }
                });
            });
        }
    );
};
