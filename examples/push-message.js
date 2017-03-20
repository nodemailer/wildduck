/* eslint no-console: 0 */

'use strict';

const recipient = process.argv[2];

if (!recipient) {
    console.error('Usage: node example.com username@exmaple.com'); // eslint-disable-line no-console
    return process.exit(1);
}

const config = require('config');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    host: 'localhost',
    port: config.smtp.port,
    logger: false
});

transporter.sendMail({
    envelope: {
        from: 'andrisööö@kreata.ee',
        to: [recipient]
    },
    from: 'andrisööö@kreata.ee',
    to: recipient,
    subject: 'Test ööö message [' + Date.now() + ']',
    text: 'Hello world! Current time is ' + new Date().toString(),
    html: '<p>Hello world! Current time is <em>' + new Date().toString() + '</em></p>',
    attachments: [{
        path: __dirname + '/swan.jpg',
        filename: 'swän.jpg'
    }]
}, (err, info) => {
    if (err && err.response) {
        console.log('Message failed: %s', err.response);
    } else if (err) {
        console.log(err);
    } else {
        console.log(info);
    }
});
