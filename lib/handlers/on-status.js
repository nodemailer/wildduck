'use strict';

const db = require('../db');

// STATUS (X Y X)
module.exports = server => (path, session, callback) => {
    server.logger.debug(
        {
            tnx: 'status',
            cid: session.id
        },
        '[%s] Requested status for "%s"',
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
        if (!mailbox) {
            return callback(null, 'NONEXISTENT');
        }

        db.database
            .collection('messages')
            .find({
                mailbox: mailbox._id
            })
            .count((err, total) => {
                if (err) {
                    return callback(err);
                }
                db.database
                    .collection('messages')
                    .find({
                        mailbox: mailbox._id,
                        seen: false
                    })
                    .count((err, unseen) => {
                        if (err) {
                            return callback(err);
                        }

                        return callback(null, {
                            messages: total,
                            uidNext: mailbox.uidNext,
                            uidValidity: mailbox.uidValidity,
                            unseen
                        });
                    });
            });
    });
};
