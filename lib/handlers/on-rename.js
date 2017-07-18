'use strict';

const db = require('../db');

// RENAME "path/to/mailbox" "new/path"
// NB! RENAME affects child and hierarchy mailboxes as well, this example does not do this
module.exports = server => (path, newname, session, callback) => {
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
    db.database.collection('mailboxes').findOne({
        user: session.user.id,
        path: newname
    }, (err, mailbox) => {
        if (err) {
            return callback(err);
        }
        if (mailbox) {
            return callback(null, 'ALREADYEXISTS');
        }
        return server.notifier.addEntries(
            session.user.id,
            path,
            {
                command: 'RENAME',
                name: newname
            },
            () => {
                db.database.collection('mailboxes').findOneAndUpdate({
                    user: session.user.id,
                    path
                }, {
                    $set: {
                        path: newname
                    }
                }, {}, (err, item) => {
                    if (err) {
                        return callback(err);
                    }

                    if (!item || !item.value) {
                        // was not able to acquire a lock
                        return callback(null, 'NONEXISTENT');
                    }

                    server.notifier.fire(session.user.id, path);
                    return callback(null, true);
                });
            }
        );
    });
};
