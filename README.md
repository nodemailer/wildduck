# Agent Wild Duck

![](https://cldup.com/qlZnwOz0na.jpg)

Wild Duck is a distributed IMAP/POP3 server built with Node.js, MongoDB and Redis. Node.js runs the application, MongoDB is used as the mail store and Redis is used for ephemeral actions like publish/subscribe, locking and caching.

> **NB!** Wild Duck is currently in **beta**. Use it on your own responsibility.

## Usage

Assuming you have MongoDB and Redis running somewhere.

### Step 1\. Get the code from github

```
$ git clone git://github.com/wildduck-email/wildduck.git
$ cd wildduck
```

### Step 2\. Install dependencies

Install dependencies from npm

```
$ npm install --production
```

### Step 3\. Modify config

You can either modify the default [config file](./config/default.js) or alternatively generate an environment related config file that gets merged with the default values. Read about the config module [here](https://www.npmjs.com/package/config)

### Step 4\. Run the server

To use the default config file, run the following

```
npm start
```

Or if you want to use environment related config file, eg from `production.js`, run the following

```
NODE_ENV=production npm start
```

### Step 5\. Create an user account

See see [below](#http-api) for details about creating new user accounts

### Step 6\. Use an IMAP/POP3 client to log in

Any IMAP or POP3 client will do. Use the credentials from step 5. to log in.

## Goals of the Project

1. Build a scalable and distributed IMAP/POP3 server that uses clustered database instead of single machine file system as mail store
2. Allow using internationalized email addresses
3. Provide Gmail-like features like pushing sent messages automatically to Sent Mail folder or notifying about messages moved to Junk folder so these could be marked as spam
4. Provide parsed mailbox and message data over HTTP. This should make creating webmail interfaces super easy, no need to parse RFC822 messages to get text content or attachments

## Alternatives

Here's a list of email/IMAP servers that use database for storing email messages

- [DBMail](http://www.dbmail.org/) (IMAP)
- [Archiveopteryx](http://archiveopteryx.org/) (IMAP)
- [ElasticInbox](http://www.elasticinbox.com/) (POP3)

## Supported features

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
- **UTF8=ACCEPT** ([RFC6855](https://tools.ietf.org/html/rfc6855)) – this also means that Wild Duck natively supports unicode email usernames. For example <андрис@уайлддак.орг> is a valid email address that is hosted by a test instance of Wild Duck
- **QUOTA** ([RFC2087](https://tools.ietf.org/html/rfc2087)) – Quota size is global for an account, using a single quota root. Be aware that quota size does not mean actual byte storage in disk, it is calculated as the sum of the [RFC822](https://tools.ietf.org/html/rfc822) sources of stored messages. Actual disk usage is larger as there are database overhead per every message.
- **COMPRESS=DEFLATE** ([RFC4978](https://tools.ietf.org/html/rfc4978)) – Compress traffic between the client and the server

Wild Duck more or less passes the [ImapTest](https://www.imapwiki.org/ImapTest/TestFeatures). Common errors that arise in the test are unknown labels (Wild Duck doesn't send unsolicited `FLAGS` updates even though it does send unsolicited `FETCH FLAGS` updates) and sometimes NO for `STORE` (messages deleted in one session can not be updated in another).

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

## FAQ

### Does it work?

Yes, it does. You can run the server and get working IMAP and POP3 servers for mail store, LMTP server for pushing messages to the mail store and HTTP API server to create new users. All handled by Node.js, MongoDB and Redis, no additional dependencies needed. Provided services can be disabled and enabled one by one so, for example you could process just IMAP in one host and LMTP in another.

### What are the killer features?

1. Start as many instances as you want. You can start multiple Wild Duck instances in different machines and as long as they share the same MongoDB and Redis settings, users can connect to any instances. This is very different from the traditional IMAP servers where a single user always needs to connect (or be proxied) to the same IMAP server. Wild Duck keeps all required state information in MongoDB, so it does not matter which IMAP instance you use.
2. Super easy to tweak. The entire codebase is pure JavaScript, so there's nothing to compile or anything platform specific. If you need to tweak something then change the code, restart the app and you're ready to go. If it works on one machine then most probably it works in every other machine as well.
3. Works almost on any OS including Windows. At least if you get MongoDB and Redis ([Windows fork](https://github.com/MSOpenTech/redis)) running first.
4. Focus on internationalization, ie. supporting email addresses with non-ascii characters
5. `+`-labels: _андрис+ööö@уайлддак.орг_ is delivered to _андрис@уайлддак.орг_
6. Access messages both using IMAP and HTTP API. The latter serves parsed data, so no need to fetch RFC822 messages and parse out html, plaintext content or attachments. It is super easy to create a webmail interface on top of this.
7. Deduplication of attachments. If the same attachment is referenced by different messages then only a single copy of the attachment is stored. Attachment is stored in the encoded form (eg. encoded in base64) to not break any signatures so the resulting encoding must match as well.

### Isn't it bad to use a database as a mail store?

Yes, historically it has been considered a bad practice to store emails in a database. And for a good reason. The data model of relational databases like MySQL does not work well with tree like structures (email mime tree) or large blobs (email source).

Notice the word "relational"? In fact document stores like MongoDB work very well with emails. Document store is great for storing tree-like structures and while GridFS is not as good as "real" object storage, it is good enough for storing the raw parts of the message. Additionally there's nothing too GridFS specific, so (at least in theory) it could be replaced with any object store.

You can see an example mail entry [here](https://gist.github.com/andris9/520d530bcc126768ce5e09e774be8c2e). Lines [184-217](https://gist.github.com/andris9/520d530bcc126768ce5e09e774be8c2e#file-entry-js-L184-L217) demonstrate a node that has its body missing as it was big enough to be moved to GridStore and not be included with the main entry.

### Is the server scalable?

Somewhat yes. Even though on some parts Wild Duck is already fast (Wild Duck is successfully tested with mailboxes up to 200K messages), there are still some important improvements that need to be done:

1. Optimize FETCH queries to load only partial data for BODY subparts
2. Parse incoming message into the mime tree as a stream. Currently the entire message is buffered in memory before being parsed.
3. CPU usage seems a bit too high, there is probably a ton of profiling to do

### How does it work?

Whenever a message is received Wild Duck parses it into a tree-like structure based on the MIME tree and stores this tree to MongoDB. Attachments are removed from the tree and stored separately in GridStore. If a message needs to be loaded then Wild Duck fetches the tree structure first and, if needed, loads attachments from GridStore and then compiles it back into the original RFC822 message. The result should be identical to the original messages unless the original message used unix newlines, these might be partially replaced with windows newlines.

Wild Duck tries to keep minimal state for sessions (basically just a list of currently known UIDs and latest MODSEQ value) to be able to distribute sessions between different hosts. Whenever a mailbox is opened the entire message list is loaded as an array of UID values. The first UID in the array element points to the message #1 in IMAP, second one points to message #2 etc.

Actual update data (information about new and deleted messages, flag updates and such) is stored to a journal log and an update beacon is propagated through Redis pub/sub whenever something happens. If a session detects that there have been some changes in the current mailbox and it is possible to notify the user about it (eg. a NOOP call was made), journaled log is loaded from the database and applied to the UID array one action at a time. Once all journaled updates have applied then the result should match the latest state. If it is not possible to notify the user (eg a FETCH call was made), then journal log is not loaded and the user continues to see the old state.

### Future considerations

1. Add interoperability with current servers, for example by fetching authentication data from MySQL
2. Maybe allow some kind of message manipulation through plugins? This would allow to turn Wild Duck for example into an encrypted mail server – mail data would be encrypted using users public key before storing it to DB and decrypted with users private key whenever the user logs in and FETCHes or SEARCHes messages. Private key would be protected by users password. For the user the encryption layer would be invisible while guaranteeing that if the user is currently not logged in then there would be no way to read the messages as the private key is locked.

## HTTP API

> **NB!** The HTTP API is being re-designed, do not build apps against the current API for now

Users, mailboxes and messages can be managed with HTTP requests against Wild Duck API

TODO:

1. Expose counters (seen/unseen messages, message count in mailbox etc.)
2. Search messages
3. Expose journal updates through WebSocket or similar

### POST /user/create

Creates a new user.

Arguments

- **username** is the username of the user. This is not an email address but authentication username, use only letters and numbers
- **password** is the password for the user
- **quota** (optional) is the maximum storage in bytes allowed for this user. If not set then the default value is used
- **retention** (optional) is the default retention time in ms for mailboxes. Messages in Trash and Junk folders have a maximum retention time of 30 days.

**Example**

```
curl -XPOST "http://localhost:8080/user/create" -H 'content-type: application/json' -d '{
  "username": "testuser",
  "password": "secretpass"
}'
```

The response for successful operation should look like this:

```json
{
  "success": true,
  "username": "testuser"
}
```

After you have created an user you can use these credentials to log in to the IMAP server. To be able to receive mail for that user you need to register an email address.

### POST /user/address/create

Creates a new email address alias for an existing user. You can use internationalized email addresses like _андрис@уайлддак.орг_.

Arguments

- **username** is the username
- **address** is the email address to use as an alias for this user
- **main** (either _true_ or _false_, defaults to _false_) indicates that this is the default address for that user

First added address becomes _main_ by default

**Example**

```
curl -XPOST "http://localhost:8080/user/address/create" -H 'content-type: application/json' -d '{
  "username": "testuser",
  "address": "user@example.com"
}'
```

The response for successful operation should look like this:

```json
{
  "success": true,
  "username": "testuser",
  "address": "user@example.com"
}
```

After you have registered a new address then LMTP maildrop server starts accepting mail for it and store the messages to the users mailbox.

### POST /user/quota

Updates maximum allowed quota for an user

Arguments

- **username** is the username of the user to modify
- **quota** (optional) is the maximum storage in bytes allowed for this user
- **recipients** (optional) is the maximum sending recipients per 24h allowed for this user. Assumes ZoneMTA with [zonemta-wildduck](https://github.com/wildduck-email/zonemta-wildduck) plugin
- **forwards** (optional) is the maximum forwarded recipients per 24h allowed for this user.

> At least one limit value must be set

**Example**

```
curl -XPOST "http://localhost:8080/user/quota" -H 'content-type: application/json' -d '{
  "username": "testuser",
  "quota": 1234567,
  "recipients": 500
}'
```

The response for successful operation should look like this:

```json
{
  "success": true,
  "username": "testuser",
  "quota": 1234567,
  "recipients": 500
}
```

Quota changes apply immediately.

### POST /user/quota/reset

Recalculates used storage for an user. Use this when it seems that quota counters for an user do not match with reality.

Arguments

- **username** is the username of the user to check

**Example**

```
curl -XPOST "http://localhost:8080/user/quota/reset" -H 'content-type: application/json' -d '{
  "username": "testuser"
}'
```

The response for successful operation should look like this:

```json
{
  "success": true,
  "username": "testuser",
  "previousStorageUsed": 1000,
  "storageUsed": 800
}
```

Be aware though that this method is not atomic and should be done only if quota counters are way off.

### POST /user/password

Updates password for an user

Arguments

- **username** is the username of the user to modify
- **password** is the new password for the user

**Example**

```
curl -XPOST "http://localhost:8080/user/password" -H 'content-type: application/json' -d '{
  "username": "testuser",
  "password": "newpass"
}'
```

The response for successful operation should look like this:

```json
{
  "success": true,
  "username": "testuser"
}
```

Password change applies immediately.

### GET /user

Returns user information including quota usage and registered addresses

Arguments

- **username** is the username of the user to modify

**Example**

```
curl "http://localhost:8080/user?username=testuser"
```

The response for successful operation should look like this:

```json
{
  "success": true,
  "username": "testuser",
  "quota": 1234567,
  "storageUsed": 1822,
  "recipients": 500,
  "recipientsLimited": false,
  "recipientsSent": 47,
  "recipientsTtl": 3392,
  "addresses": [
    {
      "id": "58d8fccb645b0deb23d6c37d",
      "address": "user@example.com",
      "main": true,
      "created": "2017-03-27T11:51:39.639Z"
    }
  ]
}
```

Where

- **recipients** – is the count of maximum recipients for 24 hour period (starts with the first message)
- **recipientsLimited** – if _true_ then sending is currently disabled as recipient limit has been reached
- **recipientsSent** – how many recipients has been used in the current 24 hour period
- **recipientsTtl** – seconds until the end of current period

Recipient limits assume that messages are sent using ZoneMTA with [zonemta-wildduck](https://github.com/wildduck-email/zonemta-wildduck) plugin, otherwise the counters are not updated.

## Message filtering

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
        seen: true,

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

* Collection: `messages`, key: `user` (by hash?)
* Collection: `attachment.files`, key: `_id` (by hash)
* Collection: `attachment.chunks`, key: `file_id` (by hash)

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

## Future considerations for IMAP extensions

Wild Duck does not plan to be the most feature-rich IMAP client in the world. Most IMAP extensions are useless because there aren't too many clients that are able to benefit from these extensions. There are a few extensions though that would make sense to be added to Wild Duck

1. IMAP4 non-synchronizing literals, LITERAL- ([RFC7888](https://tools.ietf.org/html/rfc7888)). Synchronized literals are needed for APPEND to check mailbox quota, small values could go with the non-synchronizing version.
2. LIST-STATUS ([RFC5819](https://tools.ietf.org/html/rfc5819))
3. _What else?_ (definitely not NOTIFY nor QRESYNC)

## Testing

Create an email account and use your IMAP client to connect to it. To send mail to this account, run the example script:

```
node examples/push-mail.js username@example.com
```

This should "deliver" a new message to the INBOX of _username@example.com_ by using the built-in LMTP maildrop interface. If your email client is connected then you should promptly see the new message.

## Outbound SMTP

Use [ZoneMTA](https://github.com/zone-eu/zone-mta) with the [ZoneMTA-WildDuck](https://github.com/wildduck-email/zonemta-wildduck) plugin. This gives you an outbound SMTP server that uses Wild Duck accounts for authentication.

## Inbound SMTP

Use [Haraka](http://haraka.github.io/) with [queue/lmtp](http://haraka.github.io/manual/plugins/queue/lmtp.html) plugin. Wild Duck specific recipient processing plugin coming soon!

## License

Wild Duck Mail Agent is licensed under the [European Union Public License 1.1](http://ec.europa.eu/idabc/eupl.html).
