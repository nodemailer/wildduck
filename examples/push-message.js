/* eslint no-console: 0 */

'use strict';

const recipient = process.argv[2];
const total = Number(process.argv[3]) || 1;

if (!recipient) {
    console.error('Usage: node example.com username@exmaple.com'); // eslint-disable-line no-console
    return process.exit(1);
}

const config = require('config');
const nodemailer = require('nodemailer');

const transporter = nodemailer.createTransport({
    pool: true,
    maxConnections: 10,
    host: 'localhost',
    port: config.smtp.port,
    logger: false,
    debug: false
});

let sent = 0;
let startTime = Date.now();

function send() {

    transporter.sendMail({
        envelope: {
            from: 'andris@kreata.ee',
            to: [recipient]
        },

        from: 'Kärbes 🐧 <andris@kreata.ee>',
        to: 'Ämblik 🦉 <'+recipient+'>, andmekala@hot.ee, Müriaad Polüteism <müriaad@müriaad-polüteism.org>',
        subject: 'Test ööö message [' + Date.now() + ']',
        text: 'Hello world! Current time is ' + new Date().toString(),
        html: '<p>Hello world! Current time is <em>' + new Date().toString() + '</em> <img src="cid:note@example.com"/> <img src="http://www.neti.ee/img/neti-logo-2015-1.png"></p>',
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
        sent++;
        if (sent >= total) {
            console.log('Sent %s messages in %s s', sent, (Date.now() - startTime) / 1000);
            return transporter.close();
        } else {
            send();
        }
    });
}
send();
/*
for (let i = 0; i < total; i++) {
    send();
}
*/
