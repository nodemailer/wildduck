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
    }, (err, userData) => {
        if (err) {
            return callback(err);
        }
        if (!userData) {
            return callback(new Error('User not found'));
        }

        if (userData.quota && userData.storageUsed > userData.quota) {
            return callback(false, 'OVERQUOTA');
        }
        messageHandler.encryptMessage(userData.encryptMessages ? userData.pubKey : false, raw, (err, encrypted) => {
            if (!err && encrypted) {
                raw = encrypted;
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
    });
};
