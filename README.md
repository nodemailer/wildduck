# Wild Duck Mail Agent

![](https://cldup.com/qlZnwOz0na.jpg)

This is a very early preview of an IMAP server built with Node.js, MongoDB and Redis. Node.js runs the application, MongoDB is used as the mail store and Redis is used for ephemeral actions like publish/subscribe or caching.

### Goals of the Project

1. Build a scalable IMAP server that uses clustered database instead of single machine file system as mail store
2. Push notifications. Your application (eg. a webmail client) should be able to request changes (new and deleted messages, flag changes) to be pushed to client instead of using IMAP to fetch stuff from the server
3. Provide Gmail-like features like pushing sent messages automatically to Sent Mail folder or notifying about messages moved to Junk folder so these could be marked as spam

### Supported features

Wild Duck IMAP server supports the following IMAP standards:

* The entire **IMAP4rev1** suite with some minor differences from the spec. Intentionally missing is the `\Recent` flag as it does not provide any real value, only makes things more complicated. RENAME works a bit differently than spec describes.
* **IDLE** – notfies about new and deleted messages and also about flag updates
* **CONDSTORE** and **ENABLE** – supports most of the spec, except metadata stuff which is ignored
* **STARTTLS**
* **NAMESPACE** – minimal support, just lists the single user namespace with hierarchy separator
* **UNSELECT**
* **UIDPLUS**
* **SPECIAL-USE**
* **ID**
* **AUTHENTICATE PLAIN** and **SASL-IR**

### FAQ

#### Does it work?

Yes, it does. You can run the server and get a working IMAP server for mail store, LMTP and/or SMTP servers for pushing messages to the mail store and HTTP API server to create new users. All handled by Node.js and MongoDB, no additional dependencies needed.

**Isn't it bad to use a database as a mail store?**

Yes, historically it has been considered a bad practice to store emails in a database. And for a good reason. The data model of relational databases like MySQL does not work well with tree like structures (email mime tree) or large blobs (email source).

Notice the word "relational"? In fact documents stores like MongoDB work very well with emails. Document store is great for storing tree-like structures and while GridFS is not as good as "real" object storage, it is good enough for storing the raw parts of the message.

#### Is the server scalable?

Not yet. These are some changes that need to be done:

1. Separate attachments from indexed mime tree and store these to GridFS. Currently entire message is loaded whenever a FETCH or SEARCH call is made (unless body needs not to be touched, for example if only FLAGs are checked). This also means that the message size is currently limited. MongoDB database records are capped at 16MB and this should contain also the metadata for the message.
2. Optimize SEARCH queries to use MongoDB queries. Currently only simple stuff (flag, internaldate, not flag, modseq) is included in query and more complex comparisons are handled by the application but this means that too much data must be loaded from database (unless it is a very simple query like "SEARCH UNSEEN" that is already optimized)
3. Optimize FETCH queries to load only partial data for BODY subparts
4. Parse incoming message into the mime tree as a stream. Currently the entire message is buffered in memory before being parsed.
5. Add quota handling. Every time a user gets a new message added to storage, the quota counter should increase. If only a single quota root would be used per account then implementing rfc2087 should be fairly easy. What is not so easy is keeping count on copied and deleted messages (there's a great technique for this described in the [mail.ru blog](https://team.mail.ru/efficient-storage-how-we-went-down-from-50-pb-to-32-pb/)).

#### What are the killer features?

1. Start as many instances as you want. You can start multiple Wild Duck instances in different machines and as long as they share the same MongoDB and Redis settings, users can connect to any instances. This is very different from more traditional IMAP servers where a single user always needs to connect (or proxied) to the same IMAP server. Wild Duck keeps all required state information in MongoDB, so it does not matter which IMAP instance you use.
2. Super easy to tweak. The entire codebase is pure JavaScript, so there's nothing to compile or anything platform specific. If you need to tweak something then change the code, restart the app and you're ready to go. If it works on one machine then most probably it works in every other machine as well.

## Usage

**Step 1.** Get the code from github

    $ git clone git://github.com/wildduck-email/wildduck.git
    $ cd wildduck

**Step 2.** Install dependencies

    $ npm install

**Step 3.** Modify [config file](./config/default.js)

**Step 4.** Run the [index queries](./indexes.js) in MongoDB (optional, the app would work without it as indexes only become relevant once you have more than few messages stored)

**Step 5.** Run the server

    npm start

**Step 6.** Create an user account (see [below](#create-user))

## Create user

Users can be created with HTTP requests

### POST /user/create

Arguments

  * **username** is an email address of the user
  * **password** is the password for the user

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
node examples/push.mail.js username@example.com
```

This should "deliver" a new message to the INBOX of *username@example.com* by using the built-in SMTP maildrop interface. If your email client is connected then you should promptly see the new message.

## License

Wild Duck Mail Agent is licensed under the [European Union Public License 1.1](http://ec.europa.eu/idabc/eupl.html).
