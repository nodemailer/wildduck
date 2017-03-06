# Wild Duck Mail Agent

This is a very early preview of an IMAP server built with Node.js and MongoDB.

### Goals of the Project

1. Build a scalable IMAP server that uses clustered database instead of single machine file system as mail store
2. Push notifications. Your application (eg. a webmail client) should be able to request changes (new and deleted messages, flag changes) to be pushed to client instead of using IMAP to fetch stuff from the server

### Todo

Is the server scalable? Not yet. These are some actions that must be done:

1. Separate attachments from indexed mime tree and store these to GridFS. Currently entire message is loaded whenever a FETCH or SEARCH call is made (unless body needs not to be touched, for example if only FLAGs are checked)
2. Optimize SEARCH queries to use MongoDB queries. Currently only simple stuff (flag, internaldate, not flag, modseq) is included in query and more complex comparisons are handled by the application but this means that too much data must be loaded from database (unless it is a very simple query like "SEARCH UNSEEN" that is already optimized)
3. Optimize FETCH queries to load only partial data for BODY subparts
4. Build a publish-subscribe solution to notify changes process-wide (and server-wide). Currently update notifications are propagated only inside the same process (journaled update data is available from DB for everybody but the notification that there is new data is not propagated outside current process).

## Usage

Install dependencies

    npm install --production

Modify [config file](./config/default.js)

Run the [index queries](./indexes.js) in MongoDB (optional, the app would work without it as indexes only become relevant once you have more than few messages stored)

Run the server

    npm start

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

## License

Wild Duck Mail Agent is licensed under the [European Union Public License 1.1](http://ec.europa.eu/idabc/eupl.html).
