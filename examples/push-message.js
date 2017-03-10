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
    logger: true
});

transporter.sendMail({
    envelope: {
        from: 'andris@kreata.ee',
        to: [recipient]
    },
    from: 'andris@kreata.ee',
    to: recipient,
    subject: 'Test message [' + Date.now() + ']',
    text: 'Hello world! Current time is ' + new Date().toString(),
    html: '<p>Hello world! Current time is <em>' + new Date().toString() + '</em></p>',
    attachments: [{
        path: __dirname + '/swan.jpg',
        filename: 'swän.jpg'
    }]
});
