/* global db */
'use strict';

db.users.createIndex({
    username: 1
});

db.mailboxes.createIndex({
    username: 1
});
db.mailboxes.createIndex({
    username: 1,
    path: 1
});
db.mailboxes.createIndex({
    username: 1,
    subscribed: 1
});

db.messages.createIndex({
    mailbox: 1
});

db.messages.createIndex({
    mailbox: 1,
    unseen: 1
});
db.messages.createIndex({
    mailbox: 1,
    uid: 1
});
db.messages.createIndex({
    mailbox: 1,
    uid: 1,
    modseq: 1
});
db.messages.createIndex({
    mailbox: 1,
    flags: 1
});

db.messages.createIndex({
    modseq: 1
});

db.messages.createIndex({
    modseq: -1
});

db.messages.createIndex({
    flags: 1
});

db.messages.createIndex({
    date: 1
});
db.messages.createIndex({
    date: -1
});

db.messages.createIndex({
    uid: 1
});
db.messages.createIndex({
    uid: -1
});
