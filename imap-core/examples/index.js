'use strict';

// Replace '../index' with 'imap-core' when running this script outside this directory

let IMAPServerModule = require('../index');
let IMAPServer = IMAPServerModule.IMAPServer;
let MemoryNotifier = IMAPServerModule.MemoryNotifier;

const SERVER_PORT = 9993;
const SERVER_HOST = '127.0.0.1';

// Connect to this example server by running
//    openssl s_client -crlf -connect localhost:9993
// Username is "testuser" and password is "pass"

// This example uses global folders and subscriptions
let folders = new Map();
let subscriptions = new WeakSet();

// configure initial mailbox state
[
    // INBOX
    {
        path: 'INBOX',
        uidValidity: 123,
        uidNext: 70,
        modifyIndex: 6,
        messages: [{
            uid: 45,
            flags: [],
            date: new Date(),
            modseq: 1,
            raw: Buffer.from('from: sender@example.com\r\nto: to@example.com\r\ncc: cc@example.com\r\nsubject: test')
        }, {
            uid: 49,
            flags: ['\\Seen'],
            date: new Date(),
            modseq: 2
        }, {
            uid: 50,
            flags: ['\\Seen'],
            date: new Date(),
            modseq: 3
        }, {
            uid: 52,
            flags: [],
            date: new Date(),
            modseq: 4
        }, {
            uid: 53,
            flags: [],
            date: new Date(),
            modseq: 5
        }, {
            uid: 60,
            flags: [],
            date: new Date(),
            modseq: 6
        }],
        journal: []
    },
    // [Gmail]/Sent Mail
    {
        path: '[Gmail]/Sent Mail',
        specialUse: '\\Sent',
        uidValidity: 123,
        uidNext: 90,
        modifyIndex: 0,
        messages: [],
        journal: []
    }
].forEach(folder => {
    folders.set(folder.path, folder);
    subscriptions.add(folder);
});

// Setup server
let server = new IMAPServer({
    secure: true,
    id: {
        name: 'test'
    }
});

// setup notification system for updates
server.notifier = new MemoryNotifier({
    folders
});

server.onAuth = function (login, session, callback) {
    if (login.username !== 'testuser' || login.password !== 'pass') {
        return callback();
    }

    callback(null, {
        user: {
            username: login.username
        }
    });
};

// LIST "" "*"
// Returns all folders, query is informational
// folders is either an Array or a Map
server.onList = function (query, session, callback) {
    this.logger.debug('[%s] LIST for "%s"', session.id, query);

    callback(null, folders);
};

// LSUB "" "*"
// Returns all subscribed folders, query is informational
// folders is either an Array or a Map
server.onLsub = function (query, session, callback) {
    this.logger.debug('[%s] LSUB for "%s"', session.id, query);

    let subscribed = [];
    folders.forEach(folder => {
        if (subscriptions.has(folder)) {
            subscribed.push(folder);
        }
    });

    callback(null, subscribed);
};

// SUBSCRIBE "path/to/mailbox"
server.onSubscribe = function (mailbox, session, callback) {
    this.logger.debug('[%s] SUBSCRIBE to "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    subscriptions.add(folders.get(mailbox));
    callback(null, true);
};

// UNSUBSCRIBE "path/to/mailbox"
server.onUnsubscribe = function (mailbox, session, callback) {
    this.logger.debug('[%s] UNSUBSCRIBE from "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    subscriptions.delete(folders.get(mailbox));
    callback(null, true);
};

// CREATE "path/to/mailbox"
server.onCreate = function (mailbox, session, callback) {
    this.logger.debug('[%s] CREATE "%s"', session.id, mailbox);

    if (folders.has(mailbox)) {
        return callback(null, 'ALREADYEXISTS');
    }

    folders.set(mailbox, {
        path: mailbox,
        uidValidity: Date.now(),
        uidNext: 1,
        modifyIndex: 0,
        messages: [],
        journal: []
    });

    subscriptions.add(folders.get(mailbox));
    callback(null, true);
};

// RENAME "path/to/mailbox" "new/path"
// NB! RENAME affects child and hierarchy mailboxes as well, this example does not do this
server.onRename = function (mailbox, newname, session, callback) {
    this.logger.debug('[%s] RENAME "%s" to "%s"', session.id, mailbox, newname);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    if (folders.has(newname)) {
        return callback(null, 'ALREADYEXISTS');
    }

    let oldMailbox = folders.get(mailbox);
    folders.delete(mailbox);

    oldMailbox.path = newname;
    folders.set(newname, oldMailbox);

    callback(null, true);
};

// DELETE "path/to/mailbox"
server.onDelete = function (mailbox, session, callback) {
    this.logger.debug('[%s] DELETE "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    // keep SPECIAL-USE folders
    if (folders.get(mailbox).specialUse) {
        return callback(null, 'CANNOT');
    }

    folders.delete(mailbox);
    callback(null, true);
};

// SELECT/EXAMINE
server.onOpen = function (mailbox, session, callback) {
    this.logger.debug('[%s] Opening "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    let folder = folders.get(mailbox);

    return callback(null, {
        specialUse: folder.specialUse,
        uidValidity: folder.uidValidity,
        uidNext: folder.uidNext,
        modifyIndex: folder.modifyIndex,
        uidList: folder.messages.map(message => message.uid)
    });
};

// STATUS (X Y X)
server.onStatus = function (mailbox, session, callback) {
    this.logger.debug('[%s] Requested status for "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    let folder = folders.get(mailbox);

    return callback(null, {
        messages: folder.messages.length,
        uidNext: folder.uidNext,
        uidValidity: folder.uidValidity,
        unseen: folder.messages.filter(message => message.flags.indexOf('\\Seen') < 0).length
    });
};

// APPEND mailbox (flags) date message
server.onAppend = function (mailbox, flags, date, raw, session, callback) {
    this.logger.debug('[%s] Appending message to "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'TRYCREATE');
    }

    date = date && new Date(date) || new Date();

    let folder = folders.get(mailbox);
    let message = {
        uid: folder.uidNext++,
        date: date && new Date(date) || new Date(),
        raw,
        flags
    };

    folder.messages.push(message);

    // do not write directly to stream, use notifications as the currently selected mailbox might not be the one that receives the message
    this.notifier.addEntries(session.user.username, mailbox, {
        command: 'EXISTS',
        uid: message.uid
    }, () => {
        this.notifier.fire(session.user.username, mailbox);

        return callback(null, true, {
            uidValidity: folder.uidValidity,
            uid: message.uid
        });
    });
};

// STORE / UID STORE, updates flags for selected UIDs
server.onUpdate = function (mailbox, update, session, callback) {
    this.logger.debug('[%s] Updating messages in "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    let folder = folders.get(mailbox);
    let i = 0;

    let processMessages = () => {
        if (i >= folder.messages.length) {
            this.notifier.fire(session.user.username, mailbox);
            return callback(null, true);
        }

        let message = folder.messages[i++];
        let updated = false;

        if (update.messages.indexOf(message.uid) < 0) {
            return processMessages();
        }

        switch (update.action) {
            case 'set':
                // check if update set matches current or is different
                if (message.flags.length !== update.value.length || update.value.filter(flag => message.flags.indexOf(flag) < 0).length) {
                    updated = true;
                }
                // set flags
                message.flags = [].concat(update.value);
                break;

            case 'add':
                message.flags = message.flags.concat(update.value.filter(flag => {
                    if (message.flags.indexOf(flag) < 0) {
                        updated = true;
                        return true;
                    }
                    return false;
                }));
                break;

            case 'remove':
                message.flags = message.flags.filter(flag => {
                    if (update.value.indexOf(flag) < 0) {
                        return true;
                    }
                    updated = true;
                    return false;
                });
                break;
        }

        // Onlsy show response if not silent
        if (!update.silent) {
            session.writeStream.write(session.formatResponse('FETCH', message.uid, {
                uid: update.isUid ? message.uid : false,
                flags: message.flags
            }));
        }

        // notifiy other clients only if something changed
        if (updated) {
            this.notifier.addEntries(session.user.username, mailbox, {
                command: 'FETCH',
                ignore: session.id,
                uid: message.uid,
                flags: message.flags
            }, processMessages);
        } else {
            processMessages();
        }
    };

    processMessages();
};

// EXPUNGE deletes all messages in selected mailbox marked with \Delete
// EXPUNGE deletes all messages in selected mailbox marked with \Delete
server.onExpunge = function (mailbox, update, session, callback) {
    this.logger.debug('[%s] Deleting messages from "%s"', session.id, mailbox);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    let folder = folders.get(mailbox);
    let deleted = [];
    let i, len;

    for (i = folder.messages.length - 1; i >= 0; i--) {
        if (
            (
                (update.isUid && update.messages.indexOf(folder.messages[i].uid) >= 0) ||
                !update.isUid
            ) && folder.messages[i].flags.indexOf('\\Deleted') >= 0) {

            deleted.unshift(folder.messages[i].uid);
            folder.messages.splice(i, 1);
        }
    }

    let entries = [];
    for (i = 0, len = deleted.length; i < len; i++) {
        entries.push({
            command: 'EXPUNGE',
            ignore: session.id,
            uid: deleted[i]
        });
        if (!update.silent) {
            session.writeStream.write(session.formatResponse('EXPUNGE', deleted[i]));
        }
    }

    this.notifier.addEntries(session.user.username, mailbox, entries, () => {
        this.notifier.fire(session.user.username, mailbox);
        return callback(null, true);
    });
};

// COPY / UID COPY sequence mailbox
server.onCopy = function (mailbox, update, session, callback) {
    this.logger.debug('[%s] Copying messages from "%s" to "%s"', session.id, mailbox, update.destination);

    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    if (!folders.has(update.destination)) {
        return callback(null, 'TRYCREATE');
    }

    let sourceFolder = folders.get(mailbox);
    let destinationFolder = folders.get(update.destination);

    let messages = [];
    let sourceUid = [];
    let destinationUid = [];
    let i, len;
    let entries = [];

    for (i = sourceFolder.messages.length - 1; i >= 0; i--) {
        if (update.messages.indexOf(sourceFolder.messages[i].uid) >= 0) {
            messages.unshift(JSON.parse(JSON.stringify(sourceFolder.messages[i])));
            sourceUid.unshift(sourceFolder.messages[i].uid);
        }
    }

    for (i = 0, len = messages.length; i < len; i++) {
        messages[i].uid = destinationFolder.uidNext++;
        destinationUid.push(messages[i].uid);
        destinationFolder.messages.push(messages[i]);

        // do not write directly to stream, use notifications as the currently selected mailbox might not be the one that receives the message
        entries.push({
            command: 'EXISTS',
            uid: messages[i].uid
        });
    }

    this.notifier.addEntries(update.destination, session.user.username, entries, () => {
        this.notifier.fire(update.destination, session.user.username);

        return callback(null, true, {
            uidValidity: destinationFolder.uidValidity,
            sourceUid,
            destinationUid
        });
    });
};

// sends results to socket
server.onFetch = function (mailbox, options, session, callback) {
    this.logger.debug('[%s] Requested FETCH for "%s"', session.id, mailbox);
    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    let folder = folders.get(mailbox);
    let entries = [];

    if (options.markAsSeen) {
        // mark all matching messages as seen
        folder.messages.forEach(message => {
            if (options.messages.indexOf(message.uid) < 0) {
                return;
            }

            // if BODY[] is touched, then add \Seen flag and notify other clients
            if (message.flags.indexOf('\\Seen') < 0) {
                message.flags.unshift('\\Seen');
                entries.push({
                    command: 'FETCH',
                    ignore: session.id,
                    uid: message.uid,
                    flags: message.flags
                });
            }

        });
    }

    this.notifier.addEntries(session.user.username, mailbox, entries, () => {

        folder.messages.forEach(message => {
            if (options.messages.indexOf(message.uid) < 0) {
                return;
            }
            // send formatted response to socket
            session.writeStream.write(session.formatResponse('FETCH', message.uid, {
                query: options.query,
                values: session.getQueryResponse(options.query, message)
            }));
        });

        // once messages are processed show relevant updates
        this.notifier.fire(session.user.username, mailbox);

        callback(null, true);

    });
};

// returns an array of matching UID values
server.onSearch = function (mailbox, options, session, callback) {
    if (!folders.has(mailbox)) {
        return callback(null, 'NONEXISTENT');
    }

    let folder = folders.get(mailbox);
    let highestModseq = 0;

    let uidList = folder.messages.filter(message => {
        let match = session.matchSearchQuery(message, options.query);
        if (match && highestModseq < message.modseq) {
            highestModseq = message.modseq;
        }
        return match;
    }).map(message => message.uid);

    callback(null, {
        uidList,
        highestModseq
    });
};

// -------

server.on('error', err => {
    console.log('Error occurred\n%s', err.stack); // eslint-disable-line no-console
});

process.on('SIGINT', () => {
    server.close(() => {
        process.exit();
    });
});

// start listening
server.listen(SERVER_PORT, SERVER_HOST);
