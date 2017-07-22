# Wild Duck Mail Server

Wild Duck is a distributed IMAP/POP3 mail server. _Distributed_ means that Wild Duck uses a distributed database (sharded + replicated MongoDB) as a backend for storing all data, including emails. Wild Duck instances are stateless, any user can connect to any Wild Duck instance. Wild Duck uses a write ahead log to keep IMAP sessions between different instances in sync.

Wild Duck tries to follow Gmail in architectural design. If there's a decision to be made then usually the answer is to do whatever Gmail has done.

> **NB!** Wild Duck is currently in **beta**. Use it on your own responsibility.

## Requirements

* *MongoDB* to store all data
* *Redis* for pubsub and counters
* *Node.js*, at least version 6.0.0

**Optional requirements**

* Build tools to install optional dependencies that need compiling

Wild Duck can be installed on any Node.js compatible platform.

## Usage

Assuming you have MongoDB and Redis running somewhere.

### Step 1\. Get the code from github

```
$ git clone git://github.com/nodemailer/wildduck.git
$ cd wildduck
```

### Step 2\. Install dependencies

Install dependencies from npm

```
$ npm install --production
```

### Step 3\. Run the server

To use the [default config](./config/default.toml) file, run the following:

```
node server.js
```

Or if you want to override default configuration options with your own, run the following (custom config file is merged with the default, so specify only these values that you want to change):

```
node server.js --config=/etc/wildduck.toml
```

> For additional config options, see the _wild-config_ [documentation](https://github.com/nodemailer/wild-config).

### Step 4\. Create an user account

See see [API Reference](https://github.com/nodemailer/wildduck/wiki/API-Docs#add-a-new-user) for details about creating new user accounts

### Step 5\. Use an IMAP/POP3 client to log in

Any IMAP or POP3 client will do. Use the credentials from step 4\. to log in.

## Goals of the Project

1. Build a scalable and distributed IMAP/POP3 server that uses clustered database instead of single machine file system as mail store
2. Allow using internationalized email addresses
3. Provide Gmail-like features like pushing sent messages automatically to Sent Mail folder or notifying about messages moved to Junk folder so these could be marked as spam
4. Provide parsed mailbox and message data over HTTP. This should make creating webmail interfaces super easy, no need to parse RFC822 messages to get text content or attachments

## FAQ

### Does it work?

Yes, it does. You can run the server and get working IMAP and POP3 servers for mail store, LMTP server for pushing messages to the mail store and HTTP API server to create new users. All handled by Node.js, MongoDB and Redis, no additional dependencies needed. Provided services can be disabled and enabled one by one so, for example you could process just IMAP in one host and LMTP in another.

### What are the killer features?

1. **Stateless.** Start as many instances as you want. You can start multiple Wild Duck instances in different machines and as long as they share the same MongoDB and Redis settings, users can connect to any instances. This is very different from the traditional IMAP servers where a single user always needs to connect (or be proxied) to the same IMAP server. Wild Duck keeps all required state information in MongoDB, so it does not matter which IMAP instance you use.
2. **Centralized authentication** which allows modern features like 2FA, application specific passwords, authentication scopes, revoking authentication tokens, audit logging and even profile files to auto configure Apple email clients without providing master password
3. **Works on any OS including Windows.** At least if you get MongoDB and Redis running first.
4. Focus on **internationalization**, ie. supporting email addresses with non-ascii characters
5. **De-duplication of attachments.** If the same attachment is referenced by different messages then only a single copy of the attachment is stored. Attachment is stored in the encoded form (eg. encoded in base64) to not break any signatures so the resulting encoding must match as well.
6. Access messages both using **IMAP and HTTP API**. The latter serves parsed data, so no need to fetch RFC822 messages and parse out html, plaintext content or attachments. It is super easy to create a webmail interface on top of this.
7. Built in **address labels**: _username+label@example.com_ is delivered to _username@example.com_
8. **HTTP Event Source** to push modifications in user email account to browser for super snappy webmail clients
9. **Super easy to tweak.** The entire codebase is pure JavaScript, so there's nothing to compile or anything platform specific. If you need to tweak something then change the code, restart the app and you're ready to go. If it works on one machine then most probably it works in every other machine as well.
10. **Better disk usage**. Attachment de-duplication and MongoDB compression yield in about 40% smaller disk usage as the sum of all stored email sizes.

**Demo video for HTTP push**

[![Stream Push Demo](https://img.youtube.com/vi/KFoO8x0mEpw/0.jpg)](https://www.youtube.com/watch?v=KFoO8x0mEpw)

### Isn't it bad to use a database as a mail store?

Yes, historically it has [been considered a bad practice](http://www.memoryhole.net/~kyle/databaseemail.html) to store emails in a database. And for a good reason. The data model of relational databases like MySQL does not work well with tree like structures (email mime tree) or large blobs (email source).

Notice the word "relational"? In fact document stores like MongoDB work very well with emails. Document store is great for storing tree-like structures and while GridFS is not as good as "real" object storage, it is good enough for storing the raw parts of the message. Additionally there's nothing too GridFS specific, so (at least in theory) it could be replaced with any object store.

Here's a list of alternative email servers that also use a database for storing email messages:

- [DBMail](http://www.dbmail.org/) (MySQL, IMAP)
- [Archiveopteryx](http://archiveopteryx.org/) (PostgreSQL, IMAP)
- [ElasticInbox](http://www.elasticinbox.com/) (Cassandra, POP3)

### How does it work?

Whenever a message is received Wild Duck parses it into a tree-like structure based on the MIME tree and stores this tree to MongoDB. Attachments are removed from the tree and stored separately in GridStore. If a message needs to be loaded then Wild Duck fetches the tree structure first and, if needed, loads attachments from GridStore and then compiles it back into the original RFC822 message. The result should be identical to the original messages unless the original message used unix newlines, these might be partially replaced with windows newlines.

Wild Duck tries to keep minimal state for sessions (basically just a list of currently known UIDs and latest MODSEQ value) to be able to distribute sessions between different hosts. Whenever a mailbox is opened the entire message list is loaded as an array of UID values. The first UID in the array element points to the message nr. 1 in IMAP, second one points to message nr. 2 etc.

Actual update data (information about new and deleted messages, flag updates and such) is stored to a journal log and an update beacon is propagated through Redis pub/sub whenever something happens. If a session detects that there have been some changes in the current mailbox and it is possible to notify the user about it (eg. a NOOP call was made), journaled log is loaded from the database and applied to the UID array one action at a time. Once all journaled updates have applied then the result should match the latest state. If it is not possible to notify the user (eg a FETCH call was made), then journal log is not loaded and the user continues to see the old state.

## E-Mail Protocol support

Wild Duck IMAP server supports the following IMAP standards:

- The entire **IMAP4rev1** suite with some minor differences from the spec. See below for [IMAP Protocol Differences](#imap-protocol-differences) for a complete list
- **IDLE** ([RFC2177](https://tools.ietf.org/html/rfc2177)) – notfies about new and deleted messages and also about flag updates
- **CONDSTORE** ([RFC4551](https://tools.ietf.org/html/rfc4551)) and **ENABLE** ([RFC5161](https://tools.ietf.org/html/rfc5161)) – supports most of the spec, except metadata stuff which is ignored
- **STARTTLS** ([RFC2595](https://tools.ietf.org/html/rfc2595))
- **NAMESPACE** ([RFC2342](https://tools.ietf.org/html/rfc2342)) – minimal support, just lists the single user namespace with hierarchy separator
- **UNSELECT** ([RFC3691](https://tools.ietf.org/html/rfc3691))
- **UIDPLUS** ([RFC4315](https://tools.ietf.org/html/rfc4315))
- **SPECIAL-USE** ([RFC6154](https://tools.ietf.org/html/rfc6154))
- **ID** ([RFC2971](https://tools.ietf.org/html/rfc2971))
- **MOVE** ([RFC6851](https://tools.ietf.org/html/rfc6851))
- **AUTHENTICATE PLAIN** ([RFC4959](https://tools.ietf.org/html/rfc4959)) and **SASL-IR**
- **APPENDLIMIT** ([RFC7889](https://tools.ietf.org/html/rfc7889)) – maximum global allowed message size is advertised in CAPABILITY listing
- **UTF8=ACCEPT** ([RFC6855](https://tools.ietf.org/html/rfc6855)) – this also means that Wild Duck natively supports unicode email usernames. For example [андрис@уайлддак.орг](mailto:андрис@уайлддак.орг) is a valid email address that is hosted by a test instance of Wild Duck
- **QUOTA** ([RFC2087](https://tools.ietf.org/html/rfc2087)) – Quota size is global for an account, using a single quota root. Be aware that quota size does not mean actual byte storage in disk, it is calculated as the sum of the [RFC822](https://tools.ietf.org/html/rfc822) sources of stored messages.
- **COMPRESS=DEFLATE** ([RFC4978](https://tools.ietf.org/html/rfc4978)) – Compress traffic between the client and the server

Wild Duck more or less passes the [ImapTest](https://www.imapwiki.org/ImapTest/TestFeatures) Stress Testing run. Common errors that arise in the test are unknown labels (Wild Duck doesn't send unsolicited `FLAGS` updates even though it does send unsolicited `FETCH FLAGS` updates) and sometimes NO for `STORE` (messages deleted in one session can not be updated in another).

In comparison Wild Duck is slower in processing single user than Dovecot. Especially when fetching messages, which is expected as Dovecot is reading directly from filesystem while Wild Duck is recomposing messages from different parts.

Raw read/write speed for a single user is usually not relevant anyway as fetching entire mailbox content is not something that happens often. Wild Duck offers better parallelization through MongoDB sharding, so more users should not mean slower response times. It is also more important to offer fast synchronization speeds between clients (eg. notifications about new email and such) where Wild Duck excels due to the write ahead log and the ability to push this log to clients.

### POP3 Support

In addition to the required POP3 commands ([RFC1939](https://tools.ietf.org/html/rfc1939)) Wild Duck supports the following extensions:

- **UIDL**
- **USER**
- **PASS**
- **SASL PLAIN**
- **PIPELINING**
- **TOP**

#### POP3 command behaviors

All changes to messages like deleting messages or marking messages as seen are stored in storage only in the UPDATE stage (eg. after calling QUIT). Until then the changes are preserved in memory only. This also means that if a message is downloaded but QUIT is not issued then the message does not get marked as _Seen_.

##### LIST

POP3 listing displays the newest 250 messages in INBOX (configurable)

##### UIDL

Wild Duck uses message `_id` value (24 byte hex) as the unique ID. If a message is moved from one mailbox to another then it might _re-appear_ in the listing.

##### RETR

If a messages is downloaded by a client this message gets marked as _Seen_

##### DELE

If a messages is deleted by a client this message gets marked as Seen and moved to Trash folder

# HTTP API

> **NB!** The HTTP API is being re-designed

Users, mailboxes and messages can be managed with HTTP requests against Wild Duck API

TODO:

1. Expose counters (seen/unseen messages, message count in mailbox etc.)
2. Search/list messages
3. Expose journal updates through WebSocket or similar

[API REFERENCE](https://github.com/nodemailer/wildduck/wiki/API-Docs)

## Message filtering

> The filtering system is subject to change with the API updates. Most probably the filters are going to reside in separate collection and not as part of the user object.

Wild Duck has built-in message filtering in LMTP server. This is somewhat similar to Sieve even though the filters are not scripts.

Filters are configuration objects stored in the `filters` array of the users object.

**Example filter**

```javascript
{
    // identifier for this filter
    id: ObjectId('abcdefghij...'),

    // query to check messages against
    query: {
        // message must match all filter rules for the filter actions to apply
        // all values are case insensitive
        headers: {
            // partial string match against decoded From: header
            from: 'sender@example.com',
            // partial string match against decoded To: header
            to: 'recipient@example.com',
            // partial string match against decoded Subject: header
            subject: 'Väga tõrges'
        },

        // partial string match (case insensitive) against decoded plaintext message
        text: 'Mõigu ristis oli mis?',

        // positive: must have attachments, negative: no attachments
        ha: 1,

        // positive: larger than size, negative: smaller than abs(size)
        size: 10
    },
    // what to do if the filter query matches the message
    action: {

        // mark message as seen
        unseen: false,

        // mark message as flagged
        flag: true,

        // set mailbox ID
        mailbox: 'aaaaa', // must be ObjectID!

        // positive spam, negative ham
        spam: 1,

        // if true, delete message
        delete: false
    }
}
```

**NB!** If you do not care about an action field then do not set it, otherwise matches from other filters do not apply

## Sharding

Shard the following collections by these keys:

```javascript
sh.enableSharding('wildduck');
sh.shardCollection('wildduck.messages', { mailbox: 1, uid: 1 });
sh.shardCollection('wildduck.threads', { user: 'hashed' });
sh.shardCollection('wildduck.attachments.files', { 'metadata.h': 'hashed' });
sh.shardCollection('wildduck.attachments.chunks', { files_id: 'hashed' });
```

> Attachments collections might reside in a different database than default. Modify sharding namespaces accordingly (and do not forget to enable sharding for the attachments database)

## IMAP Protocol Differences

This is a list of known differences from the IMAP specification. Listed differences are either intentional or are bugs that became features.

1. `\Recent` flags is not implemented and most probably never will be (RFC3501 2.3.2.)
2. `RENAME` does not touch subfolders which is against the spec (RFC3501 6.3.5\. _If the name has inferior hierarchical names, then the inferior hierarchical names MUST also be renamed._). Wild Duck stores all folders using flat hierarchy, the "/" separator is fake and only used for listing mailboxes
3. Unsolicited `FLAGS` responses (RFC3501 7.2.6.) and `PERMANENTFLAGS` are not sent (except for as part of `SELECT` and `EXAMINE` responses). Wild Duck notifies about flag updates only with unsolicited FETCH updates.
4. Wild Duck responds with `NO` for `STORE` if matching messages were deleted in another session
5. `CHARSET` argument for the `SEARCH` command is ignored (RFC3501 6.4.4.)
6. Metadata arguments for `SEARCH MODSEQ` are ignored (RFC7162 3.1.5.). You can define `<entry-name>` and `<entry-type-req>` values but these are not used for anything
7. `SEARCH TEXT` and `SEARCH BODY` both use MongoDB [$text index](https://docs.mongodb.com/v3.4/reference/operator/query/text/) against decoded plaintext version of the message. RFC3501 assumes that it should be a string match either against full message (`TEXT`) or body section (`BODY`).
8. What happens when FETCH is called for messages that were deleted in another session? _Not sure, need to check_

Any other differences are most probably real bugs and unintentional.

## Testing

Create an email account and use your IMAP client to connect to it. To send mail to this account, run the example script:

```
node examples/push-mail.js username@example.com
```

This should "deliver" a new message to the INBOX of _username@example.com_ by using the built-in LMTP maildrop interface. If your email client is connected then you should promptly see the new message.

## Outbound SMTP

Use [ZoneMTA](https://github.com/zone-eu/zone-mta) with the [ZoneMTA-WildDuck](https://github.com/nodemailer/zonemta-wildduck) plugin. This gives you an outbound SMTP server that uses Wild Duck accounts for authentication.

## Inbound SMTP

Use [Haraka](http://haraka.github.io/) with [queue/lmtp](http://haraka.github.io/manual/plugins/queue/lmtp.html) plugin. Wild Duck specific recipient processing plugin coming soon!

## Future considerations

- Optimize FETCH queries to load only partial data for BODY subparts
- Parse incoming message into the mime tree as a stream. Currently the entire message is buffered in memory before being parsed.
- Maybe allow some kind of message manipulation through plugins
- Wild Duck does not plan to be the most feature-rich IMAP client in the world. Most IMAP extensions are useless because there aren't too many clients that are able to benefit from these extensions. There are a few extensions though that would make sense to be added to Wild Duck:

  - IMAP4 non-synchronizing literals, LITERAL- ([RFC7888](https://tools.ietf.org/html/rfc7888)). Synchronized literals are needed for APPEND to check mailbox quota, small values could go with the non-synchronizing version.
  - LIST-STATUS ([RFC5819](https://tools.ietf.org/html/rfc5819))
  - _What else?_ (definitely not NOTIFY nor QRESYNC)

## License

Wild Duck Mail Agent is licensed under the [European Union Public License 1.1](http://ec.europa.eu/idabc/eupl.html).
