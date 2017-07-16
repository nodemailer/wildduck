/* eslint no-console:0 */

'use strict';

process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

const config = require('wild-config');
const BrowserBox = require('browserbox');

const client = new BrowserBox('localhost', config.imap.port, {
    useSecureTransport: config.imap.secure,
    auth: {
        user: 'testuser',
        pass: 'secretpass'
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
    client.upload('INBOX', 'from: sender@example.com\r\nto: to@example.com\r\ncc: cc@example.com\r\nsubject: test\r\n\r\nzzzz\r\n', false, err => {
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
