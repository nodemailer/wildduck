'use strict';

module.exports = (server, userHandler) => (login, session, callback) => {
    let username = (login.username || '').toString().trim();

    userHandler.authenticate(
        username,
        login.password,
        'imap',
        {
            protocol: 'IMAP',
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

            callback(null, {
                user: {
                    id: result.user,
                    username: result.username
                }
            });
        }
    );
};
