# WildDuck Mail Server

![](https://raw.githubusercontent.com/nodemailer/wildduck/master/assets/duck.png)

WildDuck is a scalable no-SPOF IMAP/POP3 mail server. WildDuck uses a distributed database (sharded + replicated MongoDB) as a backend for storing all data,
including emails.

WildDuck tries to follow Gmail in product design. If there's a decision to be made then usually the answer is to do whatever Gmail has done.

## Contact

[![Gitter chat](https://badges.gitter.im/gitterHQ/gitter.png)](https://gitter.im/nodemailer/wildduck)

## Requirements

-   _MongoDB_ to store all data
-   _Redis_ for pubsub and counters
-   _Node.js_ at least version 8.0.0

**Optional requirements**

-   Redis Sentinel for automatic Redis failover
-   Build tools to install optional dependencies that need compiling

WildDuck can be installed on any Node.js compatible platform.

## No-SPOF architecture

Every component of the WildDuck mail server can be replicated which eliminates potential single point of failures.

![](https://raw.githubusercontent.com/nodemailer/wildduck/master/assets/wd.png)

## Storage

Attachment de-duplication and compression gives up to 56% of storage size reduction.

![](https://raw.githubusercontent.com/nodemailer/wildduck/master/assets/storage.png)

## Usage

### Scripted install

If you have a blank VPS and a free domain name that you can point to that VPS than you can try out the scripted all-included install

[Installation instructions](./setup)

Install script installs and configures all required dependencies and services, including Let's Encrypt based certs, to run WildDuck as a mail server.

Tested on a 10\$ DigitalOcean Ubuntu 16.04 instance.

![](https://cldup.com/TZoTfxPugm.png)

-   Web interface at https://wildduck.email that uses WildDuck API

### Manual install

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

Or if you want to override default configuration options with your own, run the following (custom config file is merged with the default, so specify only these
values that you want to change):

```
node server.js --config=/etc/wildduck.toml
```

> For additional config options, see the _wild-config_ [documentation](https://github.com/nodemailer/wild-config).

### Step 4\. Create a user account

See [API Docs](https://api.wildduck.email/#api-Users-PostUser) for details about creating new user accounts

### Step 5\. Use an IMAP/POP3 client to log in

Any IMAP or POP3 client will do. Use the credentials from step 4\. to log in.

## Goals of the Project

1.  Build a scalable and distributed IMAP/POP3 server that uses clustered database instead of single machine file system as mail store
2.  Allow using internationalized email addresses
3.  Provide Gmail-like features like pushing sent messages automatically to Sent Mail folder or notifying about messages moved to Junk folder so these could be
    marked as spam
4.  Provide parsed mailbox and message data over HTTP. This should make creating webmail interfaces super easy, no need to parse RFC822 messages to get text
    content or attachments

# HTTP API

Users, mailboxes and messages can be managed with HTTP requests against WildDuck API

**[API Docs](https://api.wildduck.email/)**

# FAQ

### Does it work?

Yes, it does. You can run the server and get working IMAP and POP3 servers for mail store, LMTP server for pushing messages to the mail store and
[HTTP API](https://api.wildduck.email/) server to create new users. All handled by Node.js, MongoDB and Redis, no additional dependencies needed. Provided
services can be disabled and enabled one by one so, for example you could process just IMAP in one host and LMTP in another.

### How is security implemented in WildDuck?

Read about WildDuck security implementation from the [Wiki](https://github.com/nodemailer/wildduck/wiki/Security-implementation)

### What are the killer features?

1.  **Stateless.** Start as many instances as you want. You can start multiple WildDuck instances in different machines and as long as they share the same
    MongoDB and Redis settings, users can connect to any instances. This is very different from the traditional IMAP servers where a single user always needs to
    connect (or be proxied) to the same IMAP server. WildDuck keeps all required state information in MongoDB, so it does not matter which IMAP instance you
    use.
2.  **Scalable** as WildDuck uses sharded MongoDB cluster for the backend storage. If you're running out of space, add a new shard.
3.  **No SPOF.** You can run multiple instances of every required service.
4.  **Centralized authentication** which allows modern features like 2FA, application specific passwords, authentication scopes, revoking authentication tokens,
    audit logging and even profile files to auto-configure Apple email clients without master password
5.  **Works on any OS including Windows.** At least if you get MongoDB and Redis running first.
6.  Focus on **internationalization**, ie. supporting email addresses with non-ascii characters
7.  **Deduplication of attachments.** If the same attachment is referenced by different messages then only a single copy of the attachment is stored.
8.  Access messages both using **IMAP and [HTTP API](https://api.wildduck.email/)**. The latter serves parsed data, so no need to fetch RFC822 messages and parse
    out html, plaintext content or attachments. It is super easy to create a webmail interface on top of this.
9.  Built in **address labels**: _username+label@example.com_ is delivered to _username@example.com_
10. Dots in usernames and addresses are informational only. username@example.com is the same as user.name@example.com
11. **HTTP Event Source** to push modifications in user email account to browser for super snappy webmail clients
12. **Super easy to tweak.** The entire codebase is pure JavaScript, so there's nothing to compile or anything platform specific. If you need to tweak something
    then change the code, restart the app and you're ready to go. If it works on one machine then most probably it works in every other machine as well.
13. **Better disk usage**. Attachment deduplication and MongoDB compression yield in about 40% smaller disk usage as the sum of all stored email sizes.
14. **Extra security features** like automatic GPG encryption of all stored messages or authenticating with U2F
15. **Exposed logs.** Users have access to logs concerning their account. This includes security logs (authentication attempts, changes on account) and also
    message logs

### Isn't it bad to use a database as a mail store?

Yes, historically it has [been considered a bad practice](http://www.memoryhole.net/~kyle/databaseemail.html) to store emails in a database. And for a good
reason. The data model of relational databases like MySQL does not work well with tree like structures (email mime tree) or large blobs (email source).

Notice the word "relational"? In fact document stores like MongoDB work very well with emails. Document store is great for storing tree-like structures and
while GridFS is not as good as "real" object storage, it is good enough for storing the raw parts of the message. Additionally there's nothing too GridFS
specific, so (at least in theory) it could be replaced with any object store.

Here's a list of alternative email servers that also use a database for storing email messages:

-   [DBMail](http://www.dbmail.org/) (MySQL, IMAP)
-   [Archiveopteryx](http://archiveopteryx.org/) (PostgreSQL, IMAP)
-   [ElasticInbox](http://www.elasticinbox.com/) (Cassandra, POP3)

### How does it work?

Whenever a message is received WildDuck parses it into a tree-like structure based on the MIME tree and stores this tree to MongoDB. Attachments are removed
from the tree and stored separately in GridStore. If a message needs to be loaded then WildDuck fetches the tree structure first and, if needed, loads
attachments from GridStore and then compiles it back into the original RFC822 message. The result should be identical to the original messages unless the
original message used unix newlines, these might be partially replaced with windows newlines.

WildDuck tries to keep minimal state for sessions (basically just a list of currently known UIDs and latest MODSEQ value) to be able to distribute sessions
between different hosts. Whenever a mailbox is opened the entire message list is loaded as an array of UID values. The first UID in the array element points to
the message nr. 1 in IMAP, second one points to message nr. 2 etc.

Actual update data (information about new and deleted messages, flag updates and such) is stored to a journal log and an update beacon is propagated through
Redis pub/sub whenever something happens. If a session detects that there have been some changes in the current mailbox and it is possible to notify the user
about it (eg. a NOOP call was made), journaled log is loaded from the database and applied to the UID array one action at a time. Once all journaled updates
have applied then the result should match the latest state. If it is not possible to notify the user (eg a FETCH call was made), then journal log is not loaded
and the user continues to see the old state.

## E-Mail Protocol support

WildDuck IMAP server supports the following IMAP standards:

-   The entire **IMAP4rev1** suite with some minor differences from the spec. See below for [IMAP Protocol Differences](#imap-protocol-differences) for a complete
    list
-   **IDLE** ([RFC2177](https://tools.ietf.org/html/rfc2177)) – notfies about new and deleted messages and also about flag updates
-   **CONDSTORE** ([RFC4551](https://tools.ietf.org/html/rfc4551)) and **ENABLE** ([RFC5161](https://tools.ietf.org/html/rfc5161)) – supports most of the spec,
    except metadata stuff which is ignored
-   **STARTTLS** ([RFC2595](https://tools.ietf.org/html/rfc2595))
-   **NAMESPACE** ([RFC2342](https://tools.ietf.org/html/rfc2342)) – minimal support, just lists the single user namespace with hierarchy separator
-   **UNSELECT** ([RFC3691](https://tools.ietf.org/html/rfc3691))
-   **UIDPLUS** ([RFC4315](https://tools.ietf.org/html/rfc4315))
-   **SPECIAL-USE** ([RFC6154](https://tools.ietf.org/html/rfc6154))
-   **ID** ([RFC2971](https://tools.ietf.org/html/rfc2971))
-   **MOVE** ([RFC6851](https://tools.ietf.org/html/rfc6851))
-   **AUTHENTICATE PLAIN** ([RFC4959](https://tools.ietf.org/html/rfc4959)) and **SASL-IR**
-   **APPENDLIMIT** ([RFC7889](https://tools.ietf.org/html/rfc7889)) – maximum global allowed message size is advertised in CAPABILITY listing
-   **UTF8=ACCEPT** ([RFC6855](https://tools.ietf.org/html/rfc6855)) – this also means that WildDuck natively supports unicode email usernames. For example
    [андрис@уайлддак.орг](mailto:андрис@уайлддак.орг) is a valid email address that is hosted by a test instance of WildDuck
-   **QUOTA** ([RFC2087](https://tools.ietf.org/html/rfc2087)) – Quota size is global for an account, using a single quota root. Be aware that quota size does not
    mean actual byte storage in disk, it is calculated as the sum of the [RFC822](https://tools.ietf.org/html/rfc822) sources of stored messages.
-   **COMPRESS=DEFLATE** ([RFC4978](https://tools.ietf.org/html/rfc4978)) – Compress traffic between the client and the server

WildDuck more or less passes the [ImapTest](https://www.imapwiki.org/ImapTest/TestFeatures) Stress Testing run. Common errors that arise in the test are
unknown labels (WildDuck doesn't send unsolicited `FLAGS` updates even though it does send unsolicited `FETCH FLAGS` updates) and sometimes NO for `STORE`
(messages deleted in one session can not be updated in another).

In comparison WildDuck is slower in processing single user than Dovecot. Especially when fetching messages, which is expected as Dovecot is reading directly
from filesystem while WildDuck is recomposing messages from different parts.

Raw read/write speed for a single user is usually not relevant anyway as fetching entire mailbox content is not something that happens often. WildDuck offers
better parallelization through MongoDB sharding, so more users should not mean slower response times. It is also more important to offer fast synchronization
speeds between clients (eg. notifications about new email and such) where WildDuck excels due to the write ahead log and the ability to push this log to
clients.

### POP3 Support

In addition to the required POP3 commands ([RFC1939](https://tools.ietf.org/html/rfc1939)) WildDuck supports the following extensions:

-   **UIDL**
-   **USER**
-   **PASS**
-   **SASL PLAIN**
-   **PIPELINING**
-   **TOP**

#### POP3 command behaviors

All changes to messages like deleting messages or marking messages as seen are stored in storage only in the UPDATE stage (eg. after calling QUIT). Until then
the changes are preserved in memory only. This also means that if a message is downloaded but QUIT is not issued then the message does not get marked as _Seen_.

##### LIST

POP3 listing displays the newest 250 messages in INBOX (configurable)

##### UIDL

WildDuck uses message `_id` value (24 byte hex) as the unique ID. If a message is moved from one mailbox to another then it might _re-appear_ in the listing.

##### RETR

If a messages is downloaded by a client this message gets marked as _Seen_

##### DELE

If a messages is deleted by a client this message gets marked as Seen and moved to Trash folder

## Message filtering

WildDuck has built-in message filtering. This is somewhat similar to Sieve even though the filters are not scripts.

Filters can be managed via the [WildDuck API](https://api.wildduck.email/#api-Filters).

## IMAP Protocol Differences

This is a list of known differences from the IMAP specification. Listed differences are either intentional or are bugs that became features.

1.  `\Recent` flags is not implemented and most probably never will be (RFC3501 2.3.2.)
2.  `RENAME` does not touch subfolders which is against the spec (RFC3501 6.3.5\. _If the name has inferior hierarchical names, then the inferior hierarchical
    names MUST also be renamed._). WildDuck stores all folders using flat hierarchy, the "/" separator is fake and only used for listing mailboxes
3.  Unsolicited `FLAGS` responses (RFC3501 7.2.6.) and `PERMANENTFLAGS` are not sent (except for as part of `SELECT` and `EXAMINE` responses). WildDuck notifies
    about flag updates only with unsolicited FETCH updates.
4.  WildDuck responds with `NO` for `STORE` if matching messages were deleted in another session
5.  `CHARSET` argument for the `SEARCH` command is ignored (RFC3501 6.4.4.)
6.  Metadata arguments for `SEARCH MODSEQ` are ignored (RFC7162 3.1.5.). You can define `<entry-name>` and `<entry-type-req>` values but these are not used for
    anything
7.  `SEARCH TEXT` and `SEARCH BODY` both use MongoDB [\$text index](https://docs.mongodb.com/v3.4/reference/operator/query/text/) against decoded plaintext
    version of the message. RFC3501 assumes that it should be a string match either against full message (`TEXT`) or body section (`BODY`).
8.  What happens when FETCH is called for messages that were deleted in another session? _Not sure, need to check_
9.  **Autoexpunge**, meaning that an EXPUNGE is called on background whenever a messages gets a `\Deleted` flag set. This is not in conflict with IMAP RFCs.

Any other differences are most probably real bugs and unintentional.

## Other Differences

1. Messages retrieved from WildDuck might not be exact copies of messages that were initially stored. This mostly affects base64 encoded attachments and content in multipart mime nodes (eg. text like "This is a multi-part message in MIME format.")

## Testing

Create an email account and use your IMAP client to connect to it. To send mail to this account, run the example script:

```
node examples/push-message.js username@example.com
```

This should "deliver" a new message to the INBOX of _username@example.com_ by using the built-in LMTP maildrop interface. If your email client is connected then
you should promptly see the new message.

## Outbound SMTP

Use [WildDuck MTA](https://github.com/nodemailer/wildduck-mta) (which under the hood is [ZoneMTA](https://github.com/zone-eu/zone-mta) with the
[ZoneMTA-WildDuck](https://github.com/nodemailer/zonemta-wildduck) plugin).

This gives you an outbound SMTP server that uses WildDuck accounts for authentication. The plugin authenticates user credentials and also rewrites headers if
needed (if the header From: address does not match user address or aliases then it is rewritten).

## Inbound SMTP

Use [Haraka](http://haraka.github.io/) with [haraka-plugins-wildduck](https://github.com/nodemailer/haraka-plugin-wildduck) to validate recipient addresses and quota usage against the WildDuck users database and to store/filter messages.

#### Spam detection

Use [Rspamd plugin for Haraka](https://github.com/haraka/haraka-plugin-rspamd) in order to detect spam. WildDuck plugin detects Rspamd output and uses this information to send the message either to Inbox or Junk.

## Future considerations

-   Optimize FETCH queries to load only partial data for BODY subparts
-   Parse incoming message into the mime tree as a stream. Currently the entire message is buffered in memory before being parsed.
-   Maybe allow some kind of message manipulation through plugins
-   WildDuck does not plan to be the most feature-rich IMAP client in the world. Most IMAP extensions are useless because there aren't too many clients that are
    able to benefit from these extensions. There are a few extensions though that would make sense to be added to WildDuck:

    -   IMAP4 non-synchronizing literals, LITERAL- ([RFC7888](https://tools.ietf.org/html/rfc7888)). Synchronized literals are needed for APPEND to check mailbox
        quota, small values could go with the non-synchronizing version.
    -   LIST-STATUS ([RFC5819](https://tools.ietf.org/html/rfc5819))
    -   _What else?_ (definitely not NOTIFY nor QRESYNC)

## Operating WildDuck

### Logging

WildDuck sends gelf-formatted log messages to a Graylog server. Set `log.gelf.enabled=true` in [config](https://github.com/nodemailer/wildduck/blob/2019fd9db6bce1c3167f08e363ab4225b8c8a296/config/default.toml#L59-L66) to use it. Also make sure that the same Gelf settings are set for _zonemta-wildduck_ and _haraka-plugin-wildduck_ in order to get consistent logs about messages throughout the system.

> Graylog logging replaces previously used 'messagelog' database collection

### Import from maildir

There is a tool to import emails from an existing maildir to WildDuck email database. See the tool [here](https://github.com/nodemailer/import-maildir)

### Sharding

WildDuck supports MongoDB sharding. Consider using sharding only if you know that your data storage is large enough to outgrow single replica. Some actions
require scattered queries to be made that might be a hit on performance on a large cluster but most queries include the shard key by default.

Shard the following collections by these keys (assuming you keep attachments in a separate database):

```javascript
sh.enableSharding('wildduck');
// consider using mailbox:hashed for messages only with large shard chunk size
sh.shardCollection('wildduck.messages', { mailbox: 1, uid: 1 });
sh.shardCollection('wildduck.archived', { user: 1, _id: 1 });
sh.shardCollection('wildduck.threads', { user: 'hashed' });
sh.shardCollection('wildduck.authlog', { user: 'hashed' });

sh.enableSharding('attachments');
// attachment _id is a sha256 hash of attachment contents
sh.shardCollection('attachments.attachments.files', { _id: 'hashed' });
sh.shardCollection('attachments.attachments.chunks', { files_id: 'hashed' });

// storage _id is an ObjectID
sh.shardCollection('attachments.storage.files', { _id: 'hashed' });
sh.shardCollection('attachments.storage.chunks', { files_id: 'hashed' });
```

### Disk usage

Tests show that the ratio of attachment contents vs other stuff is around 1:10. This means that you can split your database between multiple disks by using
smaller SSD (eg. 150GB) for message data and indexes and a larger and cheaper SATA (eg. 1TB) for attachment contents. This assumes that you use WiredTiger with
`storage.directoryPerDB:true` and `storage.wiredTiger.engineConfig.directoryForIndexes:true`

Assuming that you use a database named `attachments` for attachment contents:

    SSD mount : /var/lib/mongodb
    SATA mount: /var/lib/mongodb/attachments/collection

MongoDB does not complain about existing folders so you can prepare the mount before even installing MongoDB.

### Redis Sentinel

WildDuck is able to use Redis Sentinel instead of single Redis master for automatic failover. When using Sentinel and the Redis master fails then it might take
a moment until new master is elected. Pending requests are cached during that window, so most operations should succeed eventually. You might want to test
failover under load though, to see how it behaves.

Redis Sentinel failover does not guarantee consistency. WildDuck does not store critical information in Redis, so even if some data loss occurs, it should not
be noticeable.

### HAProxy

When using HAProxy you can enable PROXY protocol to get correct remote addresses in server logs. You can use the most basic round-robin based balancing as no
persistent sessions against specific hosts are needed. Use TCP load balancing with no extra settings both for plaintext and TLS connections.

If TLS is handled by HAProxy then use the following server config to indicate that WildDuck assumes to be a TLS server but TLS is handled upstream

```toml
[imap]
secure=true # this is a TLS server
secured=true # TLS is handled upstream

[pop3]
secure=true # this is a TLS server
secured=true # TLS is handled upstream
```

### Certificates

You can live-reload updated certificates by sending SIGHUP to the master process. This causes application configuration to be re-read from the disk. Reloading
only affects only some settings, for example all TLS certificates are loaded and updated. In this case existing processes continue as is, while new ones use the
updated certs.

Beware though that if configuration loading fails, then it ends with an exception. Make sure that TLS certificate files are readable for the WildDuck user.

## License

WildDuck Mail Agent is licensed under the [European Union Public License 1.1](http://ec.europa.eu/idabc/eupl.html) or later.
