'use strict';

const db = require('../db');

// APPEND mailbox (flags) date message
module.exports = (server, messageHandler) => (path, flags, date, raw, session, callback) => {
    server.logger.debug(
        {
            tnx: 'append',
            cid: session.id
        },
        '[%s] Appending message to "%s"',
        session.id,
        path
    );

    db.users.collection('users').findOne({
        _id: session.user.id
    }, (err, user) => {
        if (err) {
            return callback(err);
        }
        if (!user) {
            return callback(new Error('User not found'));
        }

        if (user.quota && user.storageUsed > user.quota) {
            return callback(false, 'OVERQUOTA');
        }

        messageHandler.add(
            {
                user: session.user.id,
                path,
                meta: {
                    source: 'IMAP',
                    to: session.user.username,
                    time: Date.now()
                },
                session,
                date,
                flags,
                raw
            },
            (err, status, data) => {
                if (err) {
                    if (err.imapResponse) {
                        return callback(null, err.imapResponse);
                    }
                    return callback(err);
                }
                callback(null, status, data);
            }
        );
    });
};
