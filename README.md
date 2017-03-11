# Wild Duck Mail Agent

![](https://cldup.com/qlZnwOz0na.jpg)

Wild Duck is an IMAP server built with Node.js, MongoDB and Redis. Node.js runs the application, MongoDB is used as the mail store and Redis is used for ephemeral actions like publish/subscribe and caching.

> **NB!** Wild Duck is currently in **beta**. You should not use it in production.

## Goals of the Project

1. Build a scalable IMAP server that uses clustered database instead of single machine file system as mail store
2. Push notifications. Your application (eg. a webmail client) should be able to request changes (new and deleted messages, flag changes) to be pushed to client instead of using IMAP to fetch stuff from the server
3. Provide Gmail-like features like pushing sent messages automatically to Sent Mail folder or notifying about messages moved to Junk folder so these could be marked as spam

## Supported features

Wild Duck IMAP server supports the following IMAP standards:

- The entire **IMAP4rev1** suite with some minor differences from the spec. Intentionally missing is the `\Recent` flag as it does not provide any real value, only makes things more complicated. RENAME works a bit differently than spec describes.
- **IDLE** – notfies about new and deleted messages and also about flag updates
- **CONDSTORE** and **ENABLE** – supports most of the spec, except metadata stuff which is ignored
- **STARTTLS**
- **NAMESPACE** – minimal support, just lists the single user namespace with hierarchy separator
- **UNSELECT**
- **UIDPLUS**
- **SPECIAL-USE**
- **ID**
- **AUTHENTICATE PLAIN** and **SASL-IR**
- **UTF8=ACCEPT**

## FAQ

### Does it work?

Yes, it does. You can run the server and get a working IMAP server for mail store, LMTP and/or SMTP servers for pushing messages to the mail store and HTTP API server to create new users. All handled by Node.js and MongoDB, no additional dependencies needed.

### What are the killer features?

1. Start as many instances as you want. You can start multiple Wild Duck instances in different machines and as long as they share the same MongoDB and Redis settings, users can connect to any instances. This is very different from more traditional IMAP servers where a single user always needs to connect (or be proxied) to the same IMAP server. Wild Duck keeps all required state information in MongoDB, so it does not matter which IMAP instance you use.
2. Super easy to tweak. The entire codebase is pure JavaScript, so there's nothing to compile or anything platform specific. If you need to tweak something then change the code, restart the app and you're ready to go. If it works on one machine then most probably it works in every other machine as well.
3. Works almost on any OS including Windows. At least if you get MongoDB and Redis ([Windows fork](https://github.com/MSOpenTech/redis)) running first.
4. Focus on internationalization, ie. supporting email addresses with non-ascii characters

### Isn't it bad to use a database as a mail store?

Yes, historically it has been considered a bad practice to store emails in a database. And for a good reason. The data model of relational databases like MySQL does not work well with tree like structures (email mime tree) or large blobs (email source).

Notice the word "relational"? In fact documents stores like MongoDB work very well with emails. Document store is great for storing tree-like structures and while GridFS is not as good as "real" object storage, it is good enough for storing the raw parts of the message.

### Is the server scalable?

Not yet exactly. Even though on some parts Wild Duck is already fast, there are still some important improvements that need to be done:

1. Optimize SEARCH queries to use MongoDB queries. Currently only simple stuff (flag, internaldate, not flag, modseq) is included in query and more complex comparisons are handled by the application but this means that too much data must be loaded from database (unless it is a very simple query like "SEARCH UNSEEN" that is already optimized)
2. Optimize FETCH queries to load only partial data for BODY subparts
3. Parse incoming message into the mime tree as a stream. Currently the entire message is buffered in memory before being parsed.

### How does it work?

Whenever a message is received Wild Duck parses it into a tree-like structure based on the MIME tree and stores this tree to MongoDB. Larger attachments (anything above 50kB) are removed from the tree and stored separately in GridStore. If a message needs to be loaded then Wild Duck fetches the tree structure first, if needed loads attachments from GridStore and then compiles it back into the original RFC822 message. The result should be identical to the original messages unless the original message used unix newlines, these might be partially replaced with windows newlines.

Wild Duck tries to keep minimal state for sessions to be able to distribute sessions between different hosts. Whenever a mailbox is opened the entire message list is loaded as an array of UID values. The first UID in the array element points to the message #1 in IMAP, second one points to message #2 etc.

Actual update data (information about new and deleted messages, flag updates and such) is stored to a journal log and an update beacon is propagated through Redis pub/sub whenever something happens. If a session detects that there have been some changes in the current mailbox and it is possible to notify the user about it (eg. a NOOP call was made), journaled log is loaded from the database and applied to the UID array one action at a time. Once all journaled updates have applied then the result should match the latest state. If it is not possible to notify the user (eg a FETCH call was made), then journal log is not loaded and the user continues to see the old state.

### Future considerations

1. Add interoperability with current servers, for example by fetching authentication data from MySQL
2. Maybe allow some kind of message manipulation through plugins? This would allow to turn Wild Duck for example into an encrypted mail server – mail data would be encrypted using users public key before storing it to DB and decrypted with users private key whenever the user logs in and FETCHes or SEARCHes messages. Private key would be protected by users password. For the user the encryption layer would be invisible while guaranteeing that if the user is currently not logged in then there would be no way to read the messages as the private key is locked.
3. Add quota handling. Every time a user gets a new message added to storage, the quota counter should increase. If only a single quota root would be used per account then implementing rfc2087 should be fairly easy. What is not so easy is keeping count on copied and deleted messages (there's a great technique for this described in the [mail.ru blog](https://team.mail.ru/efficient-storage-how-we-went-down-from-50-pb-to-32-pb/)).

## Usage

Assuming you have MongoDB and Redis running somewhere.

**Step 1.** Get the code from github

```
$ git clone git://github.com/wildduck-email/wildduck.git
$ cd wildduck
```

**Step 2.** Install dependencies

```
$ npm install
```

**Step 3.** Modify [config file](./config/default.js)

**Step 4.** Run the [index queries](./indexes.js) in MongoDB (optional, the app would work without it as indexes only become relevant once you have more than few messages stored)

**Step 5.** Run the server

```
npm start
```

**Step 6.** Create an user account (see [below](#create-user))

## Create user

Users can be created with HTTP requests

### POST /user/create

Arguments

- **username** is an email address of the user
- **password** is the password for the user

**Example**

```
curl -XPOST "http://localhost:8080/user/create" -H 'content-type: application/json' -d '{
    "username": "username@example.com",
    "password": "secretpass"
}'
```

The response for successful operation should look like this:

```json
{
    "success": true,
    "id": "58bd6815dddb5ac5063d3590",
    "username": "username@example.com"
}
```

After you have created an user you can use these credentials to log in to the IMAP server. Additionally the LMTP server starts accepting mail for this email address.

## Testing

Create an email account and use your IMAP client to connect to it. To send mail to this account, run the example script:

```
node examples/push-mail.js username@example.com
```

This should "deliver" a new message to the INBOX of _username@example.com_ by using the built-in SMTP maildrop interface. If your email client is connected then you should promptly see the new message.

## License

Wild Duck Mail Agent is licensed under the [European Union Public License 1.1](http://ec.europa.eu/idabc/eupl.html).
