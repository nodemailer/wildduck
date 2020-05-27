'use strict';

const config = require('wild-config');
const log = require('npmlog');
const libmime = require('libmime');
const uuid = require('uuid');
const os = require('os');
const util = require('util');
const MailComposer = require('nodemailer/lib/mail-composer');
const htmlToText = require('html-to-text');
const Joi = require('../joi');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const Maildropper = require('../maildropper');
const roles = require('../roles');
const Transform = require('stream').Transform;

class StreamCollect extends Transform {
    constructor() {
        super();
        this.chunks = [];
        this.chunklen = 0;
    }
    _transform(chunk, encoding, done) {
        this.chunks.push(chunk);
        this.chunklen += chunk.length;
        this.push(chunk);
        done();
    }
}

module.exports = (db, server, messageHandler, userHandler) => {
    let maildrop = new Maildropper({
        db,
        zone: config.sender.zone,
        collection: config.sender.collection,
        gfs: config.sender.gfs
    });

    function submitMessage(options, callback) {
        let user = options.user;

        db.users.collection('users').findOne(
            { _id: user },
            {
                projection: {
                    username: true,
                    name: true,
                    address: true,
                    quota: true,
                    storageUsed: true,
                    recipients: true,
                    encryptMessages: true,
                    pubKey: true,
                    disabled: true,
                    suspended: true,
                    fromWhitelist: true
                }
            },
            (err, userData) => {
                if (err) {
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }

                if (!userData) {
                    err = new Error('This user does not exist');
                    err.code = 'UserNotFound';
                    return callback();
                }

                if (userData.disabled || userData.suspended) {
                    err = new Error('User account is disabled');
                    err.code = 'UserDisabled';
                    return callback(err);
                }

                let overQuota = Number(userData.quota || config.maxStorage * 1024 * 1024) - userData.storageUsed <= 0;
                userData.recipients = userData.recipients || config.maxRecipients;

                let getReferencedMessage = done => {
                    if (!options.reference) {
                        return done(null, false);
                    }
                    let query = {};
                    if (typeof options.reference === 'object') {
                        query.mailbox = options.reference.mailbox;
                        query.uid = options.reference.id;
                    } else {
                        return done(null, false);
                    }
                    query.user = user;

                    let getMessage = next => {
                        let updateable = ['reply', 'replyAll', 'forward'];
                        if (!options.reference || !updateable.includes(options.reference.action)) {
                            return db.database.collection('messages').findOne(
                                query,
                                {
                                    projection: {
                                        'mimeTree.parsedHeader': true,
                                        thread: true
                                    }
                                },
                                next
                            );
                        }
                        let $addToSet = {};
                        switch (options.reference.action) {
                            case 'reply':
                            case 'replyAll':
                                $addToSet.flags = '\\Answered';
                                break;
                            case 'forward':
                                $addToSet.flags = { $each: ['\\Answered', '$Forwarded'] };
                                break;
                        }

                        db.database.collection('messages').findOneAndUpdate(
                            query,
                            {
                                $addToSet
                            },
                            {
                                returnOriginal: false,
                                projection: {
                                    'mimeTree.parsedHeader': true,
                                    uid: true,
                                    flags: true,
                                    thread: true
                                }
                            },
                            (err, r) => {
                                if (err) {
                                    return next(err);
                                }

                                let messageData = r && r.value;
                                if (!messageData) {
                                    return next(null, false);
                                }

                                let notifyEntries = [
                                    {
                                        command: 'FETCH',
                                        uid: messageData.uid,
                                        flags: messageData.flags,
                                        message: messageData._id,
                                        unseenChange: false
                                    }
                                ];

                                return messageHandler.notifier.addEntries(options.reference.mailbox, notifyEntries, () => {
                                    messageHandler.notifier.fire(user);
                                    return next(null, messageData);
                                });
                            }
                        );
                    };

                    getMessage((err, messageData) => {
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        let headers = (messageData && messageData.mimeTree && messageData.mimeTree.parsedHeader) || {};
                        let subject = headers.subject || '';
                        try {
                            subject = libmime.decodeWords(subject).trim();
                        } catch (E) {
                            // failed to parse value
                        }

                        if (!/^\w+: /.test(subject)) {
                            subject = ((options.reference.action === 'forward' ? 'Fwd' : 'Re') + ': ' + subject).trim();
                        }

                        let sender = headers['reply-to'] || headers.from || headers.sender;
                        let replyTo = [];
                        let replyCc = [];
                        let uniqueRecipients = new Set();

                        let checkAddress = (target, addr) => {
                            let address = tools.normalizeAddress(addr.address);

                            if (address !== userData.address && !uniqueRecipients.has(address)) {
                                uniqueRecipients.add(address);
                                if (addr.name) {
                                    try {
                                        addr.name = libmime.decodeWords(addr.name).trim();
                                    } catch (E) {
                                        // failed to parse value
                                    }
                                }
                                target.push(addr);
                            }
                        };

                        if (sender && sender.address) {
                            checkAddress(replyTo, sender);
                        }

                        if (options.reference.action === 'replyAll') {
                            [].concat(headers.to || []).forEach(addr => {
                                let walk = addr => {
                                    if (addr.address) {
                                        checkAddress(replyTo, addr);
                                    } else if (addr.group) {
                                        addr.group.forEach(walk);
                                    }
                                };
                                walk(addr);
                            });
                            [].concat(headers.cc || []).forEach(addr => {
                                let walk = addr => {
                                    if (addr.address) {
                                        checkAddress(replyCc, addr);
                                    } else if (addr.group) {
                                        addr.group.forEach(walk);
                                    }
                                };
                                walk(addr);
                            });
                        }

                        let messageId = (headers['message-id'] || '').trim();
                        let references = (headers.references || '')
                            .trim()
                            .replace(/\s+/g, ' ')
                            .split(' ')
                            .filter(mid => mid);

                        if (messageId && !references.includes(messageId)) {
                            references.unshift(messageId);
                        }
                        if (references.length > 50) {
                            references = references.slice(0, 50);
                        }

                        let referenceData = {
                            replyTo,
                            replyCc,
                            subject,
                            thread: messageData.thread,
                            inReplyTo: messageId,
                            references: references.join(' ')
                        };

                        return done(null, referenceData);
                    });
                };

                getReferencedMessage((err, referenceData) => {
                    if (err) {
                        return callback(err);
                    }

                    let envelope = options.envelope;

                    if (!envelope) {
                        envelope = {
                            from: options.from,
                            to: []
                        };
                    }

                    if (!envelope.from) {
                        if (options.from) {
                            envelope.from = options.from;
                        } else {
                            options.from = envelope.from = {
                                name: userData.name || '',
                                address: userData.address
                            };
                        }
                    }

                    options.from = options.from || envelope.from;

                    let validateFromAddress = (address, next) => {
                        if (options.uploadOnly) {
                            // message is not sent, so we do not care if address is valid or not
                            return next(null, address);
                        }

                        if (!address || address === userData.address) {
                            // using default address, ok
                            return next(null, userData.address);
                        }

                        if (userData.fromWhitelist && userData.fromWhitelist.length) {
                            if (
                                userData.fromWhitelist.some(addr => {
                                    if (addr === address) {
                                        return true;
                                    }

                                    if (addr.charAt(0) === '*' && address.indexOf(addr.substr(1)) >= 0) {
                                        return true;
                                    }

                                    if (addr.charAt(addr.length - 1) === '*' && address.indexOf(addr.substr(0, addr.length - 1)) === 0) {
                                        return true;
                                    }

                                    return false;
                                })
                            ) {
                                // whitelisted address
                                return next(null, address);
                            }
                        }

                        userHandler.get(address, false, (err, resolvedUser) => {
                            if (err) {
                                return next(err);
                            }
                            if (!resolvedUser || resolvedUser._id.toString() !== userData._id.toString()) {
                                return next(null, userData.address);
                            }
                            return next(null, address);
                        });
                    };

                    // make sure that envelope address is allowed for current user
                    validateFromAddress(tools.normalizeAddress(envelope.from.address), (err, address) => {
                        if (err) {
                            return callback(err);
                        }
                        envelope.from.address = address;

                        // make sure that message header address is allowed for current user
                        validateFromAddress(tools.normalizeAddress(options.from.address), (err, address) => {
                            if (err) {
                                return callback(err);
                            }
                            options.from.address = address;

                            if (!envelope.to.length) {
                                envelope.to = envelope.to
                                    .concat(options.to || [])
                                    .concat(options.cc || [])
                                    .concat(options.bcc || []);
                                if (!envelope.to.length && referenceData && ['reply', 'replyAll'].includes(options.reference.action)) {
                                    envelope.to = envelope.to.concat(referenceData.replyTo || []).concat(referenceData.replyCc || []);
                                    options.to = referenceData.replyTo;
                                    options.cc = referenceData.replyCc;
                                }
                            }

                            let extraHeaders = [];
                            if (referenceData) {
                                if (['reply', 'replyAll'].includes(options.reference.action) && referenceData.inReplyTo) {
                                    extraHeaders.push({ key: 'In-Reply-To', value: referenceData.inReplyTo });
                                }
                                if (referenceData.references) {
                                    extraHeaders.push({ key: 'References', value: referenceData.references });
                                }
                            }

                            let now = new Date();
                            let sendTime = options.sendTime;
                            if (!sendTime || sendTime < now) {
                                sendTime = now;
                            }

                            let data = {
                                envelope,
                                from: options.from,
                                date: sendTime,
                                to: options.to || [],
                                cc: options.cc || [],
                                bcc: options.bcc || [],
                                subject: options.subject || (referenceData && referenceData.subject) || '',
                                text: options.text || '',
                                html: options.html || '',
                                headers: extraHeaders.concat(options.headers || []),
                                attachments: options.attachments || [],
                                disableFileAccess: true,
                                disableUrlAccess: true
                            };

                            if (data.html && typeof data.html === 'string') {
                                let fromAddress = (data.from && data.from.address).toString() || os.hostname();
                                let cids = new Map();
                                data.html = data.html.replace(/(<img\b[^>]* src\s*=[\s"']*)(data:[^"'>\s]+)/gi, (match, prefix, dataUri) => {
                                    if (cids.has(dataUri)) {
                                        return prefix + 'cid:' + cids.get(dataUri);
                                    }
                                    let cid = uuid.v4() + '-attachments@' + fromAddress.split('@').pop();
                                    data.attachments.push(
                                        processDataUrl({
                                            path: dataUri,
                                            cid
                                        })
                                    );
                                    cids.set(dataUri, cid);
                                    return prefix + 'cid:' + cid;
                                });
                            }

                            // ensure plaintext content if html is provided
                            if (data.html && !data.text) {
                                try {
                                    // might explode on long or strange strings
                                    data.text = htmlToText.fromString(data.html);
                                } catch (E) {
                                    // ignore
                                }
                            }

                            let compiler = new MailComposer(data);
                            let compiled = compiler.compile();
                            let collector = new StreamCollect();
                            let compiledEnvelope = compiled.getEnvelope();

                            let messageId = new ObjectID();
                            let addToDeliveryQueue = next => {
                                if (!compiledEnvelope.to || !compiledEnvelope.to.length || options.uploadOnly) {
                                    // no delivery, just build the message
                                    collector.on('data', () => false); //drain
                                    collector.on('end', () => {
                                        next(null, false);
                                    });
                                    collector.once('error', err => {
                                        next(err);
                                    });
                                    let stream = compiled.createReadStream();
                                    stream.once('error', err => collector.emit('error', err));
                                    stream.pipe(collector);
                                    return;
                                }

                                messageHandler.counters.ttlcounter(
                                    'wdr:' + userData._id.toString(),
                                    compiledEnvelope.to.length,
                                    userData.recipients,
                                    false,
                                    (err, result) => {
                                        if (err) {
                                            err.code = 'ERRREDIS';
                                            return callback(err);
                                        }

                                        let success = result.success;
                                        let sent = result.value;
                                        let ttl = result.ttl;

                                        let ttlHuman = false;
                                        if (ttl) {
                                            if (ttl < 60) {
                                                ttlHuman = ttl + ' seconds';
                                            } else if (ttl < 3600) {
                                                ttlHuman = Math.round(ttl / 60) + ' minutes';
                                            } else {
                                                ttlHuman = Math.round(ttl / 3600) + ' hours';
                                            }
                                        }

                                        if (!success) {
                                            log.info('API', 'RCPTDENY denied sent=%s allowed=%s expires=%ss.', sent, userData.recipients, ttl);
                                            let err = new Error(
                                                'You reached a daily sending limit for your account' + (ttl ? '. Limit expires in ' + ttlHuman : '')
                                            );
                                            err.code = 'ERRSENDINGLIMIT';
                                            return setImmediate(() => callback(err));
                                        }

                                        // push message to outbound queue
                                        let message = maildrop.push(
                                            {
                                                parentId: messageId,
                                                reason: 'submit',
                                                from: compiledEnvelope.from,
                                                to: compiledEnvelope.to,
                                                sendTime
                                            },
                                            (err, ...args) => {
                                                if (err || !args[0]) {
                                                    if (err) {
                                                        err.code = err.code || 'ERRCOMPOSE';
                                                    }
                                                    return callback(err, ...args);
                                                }

                                                let outbound = args[0].id;
                                                return next(null, outbound);
                                            }
                                        );

                                        if (message) {
                                            let stream = compiled.createReadStream();
                                            stream.once('error', err => message.emit('error', err));
                                            stream.pipe(collector).pipe(message);
                                        }
                                    }
                                );
                            };

                            addToDeliveryQueue((err, outbound) => {
                                if (err) {
                                    // ignore
                                }
                                if (overQuota) {
                                    log.info('API', 'STOREFAIL user=%s error=%s', user, 'Over quota');
                                    return callback(null, {
                                        id: false,
                                        mailbox: false,
                                        queueId: outbound,
                                        overQuota: true
                                    });
                                }

                                // Checks if the message needs to be encrypted before storing it
                                messageHandler.encryptMessage(
                                    userData.encryptMessages ? userData.pubKey : false,
                                    { chunks: collector.chunks, chunklen: collector.chunklen },
                                    (err, encrypted) => {
                                        let raw = false;
                                        if (!err && encrypted) {
                                            // message was encrypted, so use the result instead of raw
                                            raw = encrypted;
                                        }

                                        let meta = {
                                            source: 'API',
                                            from: compiledEnvelope.from,
                                            to: compiledEnvelope.to,
                                            origin: options.ip,
                                            sess: options.sess,
                                            time: new Date()
                                        };

                                        if (options.meta) {
                                            Object.keys(options.meta || {}).forEach(key => {
                                                if (!(key in meta)) {
                                                    meta[key] = options.meta[key];
                                                }
                                            });
                                        }

                                        let messageOptions = {
                                            user: userData._id,
                                            [options.mailbox ? 'mailbox' : 'specialUse']: options.mailbox
                                                ? new ObjectID(options.mailbox)
                                                : options.isDraft
                                                ? '\\Drafts'
                                                : '\\Sent',

                                            outbound,

                                            meta,

                                            date: false,
                                            flags: ['\\Seen'].concat(options.isDraft ? '\\Draft' : [])
                                        };

                                        if (raw) {
                                            messageOptions.raw = raw;
                                        } else {
                                            messageOptions.raw = Buffer.concat(collector.chunks, collector.chunklen);
                                        }

                                        messageHandler.add(messageOptions, (err, success, info) => {
                                            if (err) {
                                                log.error('API', 'SUBMITFAIL user=%s error=%s', user, err.message);
                                                err.code = 'SUBMITFAIL';
                                                return callback(err);
                                            } else if (!info) {
                                                log.info('API', 'SUBMITSKIP user=%s message=already exists', user);
                                                return callback(null, false);
                                            }

                                            let done = () =>
                                                callback(null, {
                                                    id: info.uid,
                                                    mailbox: info.mailbox,
                                                    queueId: outbound
                                                });

                                            if (options.draft) {
                                                return db.database.collection('messages').findOne(
                                                    {
                                                        mailbox: new ObjectID(options.draft.mailbox),
                                                        uid: options.draft.id
                                                    },
                                                    (err, messageData) => {
                                                        if (err || !messageData || messageData.user.toString() !== user.toString()) {
                                                            return done();
                                                        }

                                                        messageHandler.del(
                                                            {
                                                                user,
                                                                mailbox: new ObjectID(options.draft.mailbox),
                                                                messageData,
                                                                archive: !messageData.flags.includes('\\Draft')
                                                            },
                                                            done
                                                        );
                                                    }
                                                );
                                            }
                                            done();
                                        });
                                    }
                                );
                            });
                        });
                    });
                });
            }
        );
    }

    const submitMessageWrapper = util.promisify(submitMessage);

    /**
     * @api {post} /users/:user/submit Submit a Message for Delivery
     * @apiName PostSubmit
     * @apiGroup Submission
     * @apiDescription Use this method to send emails from a user account
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} user Users unique ID
     * @apiParam {Object} [reference] Optional referenced email. If submitted message is a reply and relevant fields are not provided then these are resolved from the message to be replied to
     * @apiParam {String} reference.mailbox Mailbox ID
     * @apiParam {Number} reference.id Message ID in Mailbox
     * @apiParam {String} reference.action Either <code>reply</code>, <code>replyAll</code> or <code>forward</code>
     * @apiParam {String} [mailbox] Mailbox ID where to upload the message. If not set then message is uploaded to Sent Mail folder.
     * @apiParam {Boolean} [uploadOnly=false] If <code>true</code> then generated message is not added to the sending queue
     * @apiParam {Boolean} [isDraft=false] If <code>true</code> then treats this message as draft (should be used with uploadOnly=true)
     * @apiParam {String} [sendTime] Datestring for delivery if message should be sent some later time
     * @apiParam {Object} [envelope] SMTP envelope. If not provided then resolved either from message headers or from referenced message
     * @apiParam {Object} [envelope.from] Sender information. If not set then it is resolved to User's default address
     * @apiParam {String} envelope.from.address Sender address. If this is not listed as allowed address for the sending User then it is replaced with the User's default address
     * @apiParam {Object[]} [envelope.to] Recipients information
     * @apiParam {String} envelope.to.address Recipient address
     * @apiParam {Object} [from] Address for the From: header
     * @apiParam {String} from.name Name of the sender
     * @apiParam {String} from.address Address of the sender
     * @apiParam {Object[]} [to] Addresses for the To: header
     * @apiParam {String} [to.name] Name of the recipient
     * @apiParam {String} to.address Address of the recipient
     * @apiParam {Object[]} [cc] Addresses for the Cc: header
     * @apiParam {String} [cc.name] Name of the recipient
     * @apiParam {String} cc.address Address of the recipient
     * @apiParam {Object[]} [bcc] Addresses for the Bcc: header
     * @apiParam {String} [bcc.name] Name of the recipient
     * @apiParam {String} bcc.address Address of the recipient
     * @apiParam {String} subject Message subject. If not then resolved from Reference message
     * @apiParam {String} text Plaintext message
     * @apiParam {String} html HTML formatted message
     * @apiParam {Object[]} [headers] Custom headers for the message. If reference message is set then In-Reply-To and References headers are set automatically
     * @apiParam {String} headers.key Header key ('X-Mailer')
     * @apiParam {String} headers.value Header value ('My Awesome Mailing Service')
     * @apiParam {Object[]} [attachments] Attachments for the message
     * @apiParam {String} attachments.content Base64 encoded attachment content
     * @apiParam {String} [attachments.filename] Attachment filename
     * @apiParam {String} [attachments.contentType] MIME type for the attachment file
     * @apiParam {String} [attachments.cid] Content-ID value if you want to reference to this attachment from HTML formatted message
     * @apiParam {Object} [meta] Custom metainfo for the message
     * @apiParam {String} [sess] Session identifier for the logs
     * @apiParam {String} [ip] IP address for the logs
     *
     * @apiSuccess {Boolean} success Indicates successful response
     * @apiSuccess {Object} message Information about submitted Message
     * @apiSuccess {String} message.mailbox Mailbox ID the message was stored to
     * @apiSuccess {Number} message.id Message ID in Mailbox
     * @apiSuccess {String} message.queueId Queue ID in MTA
     *
     * @apiError {String} error Description of the error
     * @apiError {String} code Reason for the error
     *
     * @apiExample {curl} Example usage:
     *     # Sender info is derived from account settings
     *     curl -i -XPOST "http://localhost:8080/users/59fc66a03e54454869460e45/submit" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "to": [{
     *         "address": "andris@ethereal.email"
     *       }],
     *       "subject": "Hello world!",
     *       "text": "Test message"
     *     }'
     *
     * @apiExample {curl} Reply to All
     *     # Recipients and subject line are derived from referenced message
     *     curl -i -XPOST "http://localhost:8080/users/59fc66a03e54454869460e45/submit" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "reference": {
     *         "mailbox": "59fc66a03e54454869460e47",
     *         "id": 15,
     *         "action": "replyAll"
     *       },
     *       "text": "Yeah, sure"
     *     }'
     *
     * @apiExample {curl} Upload only
     *     # Recipients and subject line are derived from referenced message
     *     curl -i -XPOST "http://localhost:8080/users/5a2fe496ce76ede84f177ec3/submit" \
     *     -H 'Content-type: application/json' \
     *     -d '{
     *       "reference": {
     *         "mailbox": "5a2fe496ce76ede84f177ec4",
     *         "id": 1,
     *         "action": "replyAll"
     *       },
     *       "uploadOnly": true,
     *       "mailbox": "5a33b45acf482d3219955bc4",
     *       "text": "Yeah, sure"
     *     }'
     *
     * @apiSuccessExample {json} Success-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "success": true,
     *       "message": {
     *         "id": 16,
     *         "mailbox": "59fc66a03e54454869460e47",
     *         "queueId": "1600798505b000a25f"
     *       }
     *     }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "User account is disabled",
     *       "code": "ERRDISABLEDUSER"
     *     }
     */
    server.post(
        { name: 'send', path: '/users/:user/submit' },
        tools.asyncifyJson(async (req, res, next) => {
            res.charSet('utf-8');

            const schema = Joi.object().keys({
                user: Joi.string().hex().lowercase().length(24).required(),

                mailbox: Joi.string().hex().lowercase().length(24),

                reference: Joi.object().keys({
                    mailbox: Joi.string().hex().lowercase().length(24).required(),
                    id: Joi.number().required(),
                    action: Joi.string().valid('reply', 'replyAll', 'forward').required()
                }),

                // if true then treat this message as a draft
                isDraft: Joi.boolean().empty('').truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']).default(false),

                // if set then this message is based on a draft that should be deleted after processing
                draft: Joi.object().keys({
                    mailbox: Joi.string().hex().lowercase().length(24).required(),
                    id: Joi.number().required()
                }),

                uploadOnly: Joi.boolean().empty('').truthy(['Y', 'true', 'yes', 'on', '1', 1]).falsy(['N', 'false', 'no', 'off', '0', 0, '']).default(false),

                sendTime: Joi.date(),

                envelope: Joi.object().keys({
                    from: Joi.object().keys({
                        name: Joi.string().empty('').max(255),
                        address: Joi.string().email().required()
                    }),
                    to: Joi.array().items(
                        Joi.object().keys({
                            name: Joi.string().empty('').max(255),
                            address: Joi.string().email().required()
                        })
                    )
                }),

                from: Joi.object().keys({
                    name: Joi.string().empty('').max(255),
                    address: Joi.string().email().required()
                }),

                replyTo: Joi.object().keys({
                    name: Joi.string().empty('').max(255),
                    address: Joi.string().email().required()
                }),

                to: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string().empty('').max(255),
                        address: Joi.string().email().required()
                    })
                ),

                cc: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string().empty('').max(255),
                        address: Joi.string().email().required()
                    })
                ),

                bcc: Joi.array().items(
                    Joi.object().keys({
                        name: Joi.string().empty('').max(255),
                        address: Joi.string().email().required()
                    })
                ),

                headers: Joi.array().items(
                    Joi.object().keys({
                        key: Joi.string().empty('').max(255),
                        value: Joi.string()
                            .empty('')
                            .max(100 * 1024)
                    })
                ),

                subject: Joi.string().empty('').max(255),
                text: Joi.string()
                    .empty('')
                    .max(1024 * 1024),
                html: Joi.string()
                    .empty('')
                    .max(1024 * 1024),

                attachments: Joi.array().items(
                    Joi.object().keys({
                        filename: Joi.string().empty('').max(255),
                        contentType: Joi.string().empty('').max(255),
                        encoding: Joi.string().empty('').default('base64'),
                        contentTransferEncoding: Joi.string().empty(''),
                        content: Joi.string().required(),
                        cid: Joi.string().empty('').max(255)
                    })
                ),
                meta: Joi.object().unknown(true),
                sess: Joi.string().max(255),
                ip: Joi.string().ip({
                    version: ['ipv4', 'ipv6'],
                    cidr: 'forbidden'
                })
            });

            const result = Joi.validate(req.params, schema, {
                abortEarly: false,
                convert: true,
                allowUnknown: true
            });

            if (result.error) {
                res.status(400);
                res.json({
                    error: result.error.message,
                    code: 'InputValidationError'
                });
                return next();
            }

            // permissions check
            if (req.user && req.user === result.value.user) {
                req.validate(roles.can(req.role).createOwn('messages'));
            } else {
                req.validate(roles.can(req.role).createAny('messages'));
            }

            result.value.user = new ObjectID(result.value.user);
            if (result.value.reference && result.value.reference.mailbox) {
                result.value.reference.mailbox = new ObjectID(result.value.reference.mailbox);
            }

            let info;
            try {
                info = await submitMessageWrapper(result.value);
            } catch (err) {
                log.error('API', 'SUBMIT error=%s', err.message);
                res.json({
                    error: err.message,
                    code: err.code
                });
                return next();
            }

            res.json({
                success: true,
                message: info
            });

            next();
        })
    );
};

function processDataUrl(element) {
    let parts = (element.path || element.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
    if (!parts) {
        return element;
    }

    element.content = /\bbase64$/i.test(parts[1]) ? Buffer.from(parts[2], 'base64') : Buffer.from(decodeURIComponent(parts[2]));

    if ('path' in element) {
        element.path = false;
    }

    if ('href' in element) {
        element.href = false;
    }

    parts[1].split(';').forEach(item => {
        if (/^\w+\/[^/]+$/i.test(item)) {
            element.contentType = element.contentType || item.toLowerCase();
        }
    });

    return element;
}
