/* eslint no-console:0 */

'use strict';
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';
const rawpath = process.argv[2];

const config = require('wild-config');
const BrowserBox = require('browserbox');

const raw = require('fs').readFileSync(rawpath);
console.log('Processing %s of %s bytes', rawpath, raw.length);

const client = new BrowserBox('localhost', config.imap.port, {
    useSecureTransport: config.imap.secure,
    auth: {
        user: 'myuser',
        pass: 'verysecret'
    },
    id: {
        name: 'My Client',
        version: '0.1'
    },
    tls: {
        rejectUnauthorized: false
    }
});

client.onerror = function(err) {
    console.log(err);
    process.exit(1);
};

client.onauth = function() {
    client.upload('INBOX', raw, false, err => {
        if (err) {
            console.log(err);
            return process.exit(1);
        }

        client.selectMailbox('INBOX', (err, mailbox) => {
            if (err) {
                console.log(err);
                return process.exit(1);
            }
            console.log(mailbox);

            client.listMessages(mailbox.exists, ['BODY.PEEK[]', 'BODYSTRUCTURE'], (err, data) => {
                if (err) {
                    console.log(err);
                    return process.exit(1);
                }
                console.log('<<<%s>>>', data[0]['body[]']);
                return process.exit(0);
            });
        });
    });
};

client.connect();
