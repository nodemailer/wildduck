'use strict';

const db = require('../db');

// CREATE "path/to/mailbox"
module.exports = server => (path, session, callback) => {
    server.logger.debug(
        {
            tnx: 'create',
            cid: session.id
        },
        '[%s] CREATE "%s"',
        session.id,
        path
    );
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (mailbox) {
            return callback(null, 'ALREADYEXISTS');
        }

        db.users.collection('users').findOne({
            _id: session.user.id
        }, {
            fields: {
                retention: true
            }
        }, (err, user) => {
            if (err) {
                return callback(err);
            }

            mailbox = {
                user: session.user.id,
                path,
                uidValidity: Math.floor(Date.now() / 1000),
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true,
                flags: [],
                retention: user.retention
            };

            db.database.collection('mailboxes').insertOne(mailbox, (err, r) => {
                if (err) {
                    return callback(err);
                }
                return server.notifier.addEntries(
                    session.user.id,
                    path,
                    {
                        command: 'CREATE',
                        mailbox: r.insertId,
                        name: path
                    },
                    () => {
                        server.notifier.fire(session.user.id, path);
                        return callback(null, true);
                    }
                );
            });
        });
    });
};
