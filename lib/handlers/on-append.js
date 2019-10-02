'use strict';

const config = require('wild-config');
const db = require('../db');
const consts = require('../consts');

// APPEND mailbox (flags) date message
module.exports = (server, messageHandler, userCache) => (path, flags, date, raw, session, callback) => {
    server.logger.debug(
        {
            tnx: 'append',
            cid: session.id
        },
        '[%s] Appending message to "%s"',
        session.id,
        path
    );

    db.users.collection('users').findOne(
        {
            _id: session.user.id
        },
        {
            maxTimeMS: consts.DB_MAX_TIME_USERS
        },
        (err, userData) => {
            if (err) {
                return callback(err);
            }
            if (!userData) {
                return callback(new Error('User not found'));
            }

            if (userData.quota && userData.storageUsed > userData.quota) {
                return callback(false, 'OVERQUOTA');
            }

            userCache.get(session.user.id, 'imapMaxUpload', (config.imap.maxUploadMB || 10) * 1024 * 1024, (err, limit) => {
                if (err) {
                    return callback(err);
                }
                messageHandler.counters.ttlcounter('iup:' + session.user.id, 0, limit, false, (err, res) => {
                    if (err) {
                        return callback(err);
                    }
                    if (!res.success) {
                        let err = new Error('Upload was rate limited. Try again in ' + res.ttl + ' seconds');
                        err.response = 'NO';
                        return callback(err);
                    }

                    messageHandler.counters.ttlcounter('iup:' + session.user.id, raw.length, limit, false, () => {
                        flags = Array.isArray(flags) ? flags : [].concat(flags || []);

                        messageHandler.encryptMessage(
                            userData.encryptMessages && !flags.includes('\\Draft') ? userData.pubKey : false,
                            raw,
                            (err, encrypted) => {
                                if (!err && encrypted) {
                                    raw = encrypted;
                                }
                                messageHandler.add(
                                    {
                                        user: session.user.id,
                                        path,
                                        meta: {
                                            source: 'IMAP',
                                            from: '',
                                            to: [session.user.address || session.user.username],
                                            origin: session.remoteAddress,
                                            transtype: 'APPEND',
                                            time: new Date()
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
                            }
                        );
                    });
                });
            });
        }
    );
};
