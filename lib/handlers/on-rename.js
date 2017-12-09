'use strict';

const db = require('../db');

// RENAME "path/to/mailbox" "new/path"
// NB! RENAME affects child and hierarchy mailboxes as well, this example does not do this
module.exports = (server, mailboxHandler) => (path, newname, session, callback) => {
    server.logger.debug(
        {
            tnx: 'rename',
            cid: session.id
        },
        '[%s] RENAME "%s" to "%s"',
        session.id,
        path,
        newname
    );

    db.database.collection('mailboxes').findOne(
        {
            user: session.user.id,
            path
        },
        (err, mailbox) => {
            if (err) {
                return callback(err);
            }
            if (!mailbox) {
                return callback(null, 'NONEXISTENT');
            }

            mailboxHandler.rename(session.user.id, mailbox._id, newname, false, callback);
        }
    );
};
