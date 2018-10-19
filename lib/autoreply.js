'use strict';

const MailComposer = require('nodemailer/lib/mail-composer');
const MessageSplitter = require('./message-splitter');
const consts = require('./consts');
const errors = require('./errors');

module.exports = (options, autoreplyData, callback) => {
    if (!options.sender || /mailer-daemon|no-?reply/gi.test(options.sender)) {
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

        options.db.redis
            .multi()
            // delete all old entries
            .zremrangebyscore('war:' + autoreplyData._id, '-inf', Date.now() - consts.MAX_AUTOREPLY_INTERVAL)
            // add new entry if not present
            .zadd('war:' + autoreplyData._id, 'NX', Date.now(), options.sender)
            // if no-one touches this key from now, then delete after max interval has passed
            .expire('war:' + autoreplyData._id, consts.MAX_AUTOREPLY_INTERVAL)
            .exec((err, result) => {
                if (err) {
                    errors.notify(err, { userId: autoreplyData._id });
                    return callback(null, false);
                }

                if (!result || !result[1] || !result[1][1]) {
                    // already responded
                    return callback(null, false);
                }

                // check limiting counters
                options.messageHandler.counters.ttlcounter('wda:' + autoreplyData._id, 1, consts.MAX_AUTOREPLIES, false, (err, result) => {
                    if (err || !result.success) {
                        return callback(null, false);
                    }

                    let inReplyTo = Buffer.from(headers.getFirst('Message-ID'), 'binary').toString();

                    let data = {
                        envelope: {
                            from: '',
                            to: options.sender
                        },
                        from: {
                            name: autoreplyData.name || (options.userData && options.userData.name),
                            address: options.recipient
                        },
                        to: options.sender,
                        subject: (autoreplyData.subject && 'Auto: ' + autoreplyData.subject) || {
                            prepared: true,
                            value: 'Auto: Re: ' + Buffer.from(headers.getFirst('Subject'), 'binary').toString()
                        },
                        headers: {
                            'Auto-Submitted': 'auto-replied',
                            'X-WD-Autoreply-For': (options.parentId || options.queueId).toString()
                        },
                        inReplyTo,
                        references: (inReplyTo + ' ' + Buffer.from(headers.getFirst('References'), 'binary').toString()).trim(),
                        text: autoreplyData.text,
                        html: autoreplyData.html
                    };

                    let compiler = new MailComposer(data);
                    let message = options.maildrop.push(
                        {
                            parentId: options.parentId,
                            reason: 'autoreply',
                            from: '',
                            to: options.sender,
                            interface: 'autoreplies'
                        },
                        (err, ...args) => {
                            if (err || !args[0]) {
                                if (err) {
                                    err.code = err.code || 'ERRCOMPOSE';
                                }
                                return callback(err, ...args);
                            }
                            let logentry = {
                                id: args[0].id,
                                messageId: args[0].messageId,
                                action: 'AUTOREPLY',
                                from: '',
                                to: options.sender,
                                sender: options.recipient,
                                created: new Date()
                            };

                            if (options.parentId) {
                                logentry.parentId = options.parentId;
                            }
                            if (options.queueId) {
                                logentry.queueId = options.queueId;
                            }

                            return callback(err, args && args[0].id);
                        }
                    );

                    if (message) {
                        compiler
                            .compile()
                            .createReadStream()
                            .pipe(message);
                    }
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
