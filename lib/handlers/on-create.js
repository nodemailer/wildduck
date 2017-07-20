'use strict';

// CREATE "path/to/mailbox"
module.exports = (server, mailboxHandler) => (path, session, callback) => {
    server.logger.debug(
        {
            tnx: 'create',
            cid: session.id
        },
        '[%s] CREATE "%s"',
        session.id,
        path
    );
    mailboxHandler.create(session.user.id, path, { subscribed: true }, callback);
};
