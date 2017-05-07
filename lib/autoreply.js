'use strict';

const MailComposer = require('nodemailer/lib/mail-composer');
const MessageSplitter = require('./message-splitter');
const db = require('./db');
const maildrop = require('./maildrop');

const MAX_AUTOREPLY_INTERVAL = 4 * 24 * 3600 * 1000;

module.exports = (options, callback) => {
    // step 1. check if recipient is valid (non special address)
    // step 2. check if recipient not in cache list
    // step 3. parse headers, check if not automatic message
    // step 4. prepare message with special headers (in-reply-to, references, Auto-Submitted)

    if (!options.sender || /mailer\-daemon/i.test(options.sender)) {
        return callback(null, false);
    }

    let messageHeaders = false;
    let messageSplitter = new MessageSplitter();

    messageSplitter.once('headers', headers => {
        messageHeaders = headers;

        let autoSubmitted = headers.getFirst('Auto-Submitted');
        if (autoSubmitted && autoSubmitted.toLowerCase() !== 'no') {
            // skip automatic messages
            return callback(null, false);
        }
        let precedence = headers.getFirst('Precedence');
        if (precedence && ['list', 'junk', 'bulk'].includes(precedence.toLowerCase())) {
            return callback(null, false);
        }
        let listUnsubscribe = headers.getFirst('List-Unsubscribe');
        if (listUnsubscribe) {
            return callback(null, false);
        }
        let suppressAutoresponse = headers.getFirst('X-Auto-Response-Suppress');
        if (suppressAutoresponse && /OOF|AutoReply/i.test(suppressAutoresponse)) {
            return callback(null, false);
        }

        // check limiting counters
        options.messageHandler.counters.ttlcounter('wda:' + options.user._id, 1, 2000, (err, result) => {
            if (err || !result.success) {
                return callback(null, false);
            }

            db.redis.multi().
            // delete all old entries
            zremrangebyscore('war:' + options.user._id, '-inf', Date.now() - MAX_AUTOREPLY_INTERVAL).
            // add enw entry if not present
            zadd('war:' + options.user._id, 'NX', Date.now(), options.sender).
            exec((err, response) => {
                if (err) {
                    return callback(null, false);
                }

                if (!response || !response[1]) {
                    // already responded
                    return callback(null, false);
                }

                let data = {
                    envelope: {
                        from: '',
                        to: options.sender
                    },
                    from: {
                        name: options.user.name,
                        address: options.recipient
                    },
                    to: options.sender,
                    subject: options.user.autoreply.subject ? 'Auto: ' + options.user.autoreply.subject : {
                        prepared: true,
                        value: 'Auto: Re: ' + headers.getFirst('Subject')
                    },
                    headers: {
                        'Auto-Submitted': 'auto-replied'
                    },
                    inReplyTo: headers.getFirst('Message-ID'),
                    references: (headers.getFirst('Message-ID') + ' ' + headers.getFirst('References')).trim(),
                    text: options.user.autoreply.message
                };

                let compiler = new MailComposer(data);
                let message = maildrop({
                    from: '',
                    to: options.sender,
                    interface: 'autoreply'
                }, callback);

                compiler.compile().createReadStream().pipe(message);
            });
        });
    });
    messageSplitter.on('error', () => false);
    messageSplitter.on('data', () => false);
    messageSplitter.on('end', () => false);

    setImmediate(() => {
        let pos = 0;
        let writeNextChunk = () => {
            if (messageHeaders || pos >= options.chunks.length) {
                return messageSplitter.end();
            }
            let chunk = options.chunks[pos++];
            if (!messageSplitter.write(chunk)) {
                return messageSplitter.once('drain', writeNextChunk);
            } else {
                setImmediate(writeNextChunk);
            }
        };
        setImmediate(writeNextChunk);
    });
};
