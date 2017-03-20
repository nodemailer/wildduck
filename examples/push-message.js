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
    logger: false,
    debug: false
});

transporter.sendMail({
    envelope: {
        from: 'andris@kreata.ee',
        to: [recipient]
    },
    from: 'andris@kreata.ee',
    to: recipient,
    subject: 'Test ööö message [' + Date.now() + ']',
    text: 'Hello world! Current time is ' + new Date().toString() + ' <img src="cid:note@example.com"/>',
    html: '<p>Hello world! Current time is <em>' + new Date().toString() + '</em></p>',
    attachments: [

        // attachment as plaintext
        {
            filename: 'notes.txt',
            content: 'Some notes about this e-mail',
            contentType: 'text/plain' // optional, would be detected from the filename
        },

        // Small Binary Buffer attachment, should be kept with message
        {
            filename: 'image.png',
            content: new Buffer('iVBORw0KGgoAAAANSUhEUgAAABAAAAAQAQMAAAAlPW0iAAAABlBMVEUAAAD/' +
                '//+l2Z/dAAAAM0lEQVR4nGP4/5/h/1+G/58ZDrAz3D/McH8yw83NDDeNGe4U' +
                'g9C9zwz3gVLMDA/A6P9/AFGGFyjOXZtQAAAAAElFTkSuQmCC', 'base64'),

            cid: 'note@example.com' // should be as unique as possible
        },

        // Large Binary Buffer attachment, should be kept separately
        {
            path: __dirname + '/swan.jpg',
            filename: 'swän.jpg'
        }
    ]
}, (err, info) => {
    if (err && err.response) {
        console.log('Message failed: %s', err.response);
    } else if (err) {
        console.log(err);
    } else {
        console.log(info);
    }
});
