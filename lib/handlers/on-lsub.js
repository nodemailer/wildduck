'use strict';

const db = require('../db');

// LSUB "" "*"
// Returns all subscribed folders, query is informational
// folders is either an Array or a Map
module.exports = server => (query, session, callback) => {
    server.logger.debug(
        {
            tnx: 'lsub',
            cid: session.id
        },
        '[%s] LSUB for "%s"',
        session.id,
        query
    );
    db.database
        .collection('mailboxes')
        .find({
            user: session.user.id,
            subscribed: true
        })
        .maxTimeMS(500)
        .toArray(callback);
};
