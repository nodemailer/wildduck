'use strict';

const db = require('../db');

// SUBSCRIBE "path/to/mailbox"
module.exports = server => (path, session, callback) => {
    server.logger.debug(
        {
            tnx: 'subscribe',
            cid: session.id
        },
        '[%s] SUBSCRIBE to "%s"',
        session.id,
        path
    );
    db.database.collection('mailboxes').findOneAndUpdate(
        {
            user: session.user.id,
            path
        },
        {
            $set: {
                subscribed: true
            }
        },
        {
            maxTimeMS: 500
        },
        (err, item) => {
            if (err) {
                return callback(err);
            }

            if (!item || !item.value) {
                // was not able to acquire a lock
                return callback(null, 'NONEXISTENT');
            }

            callback(null, true);
        }
    );
};
