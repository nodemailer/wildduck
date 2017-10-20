'use strict';

const MailComposer = require('nodemailer/lib/mail-composer');
const MessageSplitter = require('./message-splitter');
const db = require('./db');
const consts = require('./consts');
const errors = require('./errors');
const maildrop = require('./maildrop');

module.exports = (options, callback) => {
    if (!options.sender || /mailer-daemon|no-?reply/gi.test(options.sender)) {
        return callback(null, false);
    }

    db.database.collection('autoreplies').findOne({ user: options.userData._id }, (err, autoreply) => {
        if (err) {
            return callback(err);
        }

        if (!autoreply || !autoreply.status) {
            return callback(null, false);
        }

        // step 1. check if recipient is valid (non special address)
        // step 2. check if recipient not in cache list
        // step 3. parse headers, check if not automatic message
        // step 4. prepare message with special headers (in-reply-to, references, Auto-Submitted)

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

            db.redis
                .multi()
                // delete all old entries
                .zremrangebyscore('war:' + options.userData._id, '-inf', Date.now() - consts.MAX_AUTOREPLY_INTERVAL)
                // add enw entry if not present
                .zadd('war:' + options.userData._id, 'NX', Date.now(), options.sender)
                .exec((err, result) => {
                    if (err) {
                        errors.notify(err, { userId: options.userData._id });
                        return callback(null, false);
                    }

                    if (!result || !result[1] || !result[1][1]) {
                        // already responded
                        return callback(null, false);
                    }

                    // check limiting counters
                    options.messageHandler.counters.ttlcounter('wda:' + options.userData._id, 1, consts.MAX_AUTOREPLIES, false, (err, result) => {
                        if (err || !result.success) {
                            return callback(null, false);
                        }

                        let data = {
                            envelope: {
                                from: '',
                                to: options.sender
                            },
                            from: {
                                name: options.userData.name,
                                address: options.recipient
                            },
                            to: options.sender,
                            subject: autoreply.subject
                                ? 'Auto: ' + autoreply.subject
                                : {
                                    prepared: true,
                                    value: 'Auto: Re: ' + headers.getFirst('Subject')
                                },
                            headers: {
                                'Auto-Submitted': 'auto-replied'
                            },
                            inReplyTo: headers.getFirst('Message-ID'),
                            references: (headers.getFirst('Message-ID') + ' ' + headers.getFirst('References')).trim(),
                            text: autoreply.message
                        };

                        let compiler = new MailComposer(data);
                        let message = maildrop(
                            {
                                parentId: options.parentId,
                                reason: 'autoreply',
                                from: '',
                                to: options.sender,
                                interface: 'autoreplies'
                            },
                            (err, ...args) => {
                                if (err || !args[0]) {
                                    return callback(err, ...args);
                                }
                                db.database.collection('messagelog').insertOne({
                                    id: args[0],
                                    parentId: options.parentId,
                                    action: 'AUTOREPLY',
                                    from: '',
                                    to: options.sender,
                                    created: new Date()
                                }, () => callback(err, ...args));
                            }
                        );

                        compiler
                            .compile()
                            .createReadStream()
                            .pipe(message);
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
    });
};
