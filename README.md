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

## License

Wild Duck Mail Agent is licensed under the [European Union Public License 1.1](http://ec.europa.eu/idabc/eupl.html).
