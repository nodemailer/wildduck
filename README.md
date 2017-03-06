# Wild Duck Mail Agent

This is a very early preview of an IMAP server built with Node.js and MongoDB.

### Goals of the Project

1. Build a scalable IMAP server that uses clustered database instead of single machine file system as mail store
2. Push notifications. Your application (eg. a webmail client) should be able to request changes (new and deleted messages, flag changes) to be pushed to client instead of using IMAP to fetch stuff from the server

## Usage

Install dependencies

    npm install --production

Modify [config file](./config/default.js)

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
