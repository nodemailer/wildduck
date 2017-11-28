'use strict';

const crypto = require('crypto');
const Joi = require('joi');
const ObjectID = require('mongodb').ObjectID;
const tools = require('../tools');
const base32 = require('base32.js');

module.exports = (db, server, notifier) => {
    /**
     * @api {get} /users/:id/updates Open change stream
     * @apiName GetUpdates
     * @apiGroup Users
     * @apiDescription This api call returns an EventSource response. Listen on this stream to get
     * notifications about changes in messages and mailboxes. Returned events are JSON encoded strings
     *
     * @apiHeader {String} X-Access-Token Optional access token if authentication is enabled
     * @apiHeaderExample {json} Header-Example:
     * {
     *   "X-Access-Token": "59fc66a03e54454869460e45"
     * }
     *
     * @apiParam {String} id Users unique ID.
     *
     * @apiSuccess {String} command Indicates data event type
     *
     * @apiError error Description of the error
     *
     * @apiExample {javascript} Example usage:
     *     var stream = new EventSource('/users/59fc66a03e54454869460e45/updates');
     *     stream.onmessage = function(e) {
     *       console.log(JSON.parse(e.data));
     *     };
     *
     * @apiSuccessExample {text} Success-Response:
     *     HTTP/1.1 200 OK
     *     Content-Type: text/event-stream
     *
     *     data: {
     *     data:   "command": "CREATE",
     *     data:   "mailbox": "5a1d3061153888cdcd62a719",
     *     data:   "path": "First Level/Second 😎 Level/Folder Name"
     *     data: }
     *
     * @apiErrorExample {json} Error-Response:
     *     HTTP/1.1 200 OK
     *     {
     *       "error": "This user does not exist"
     *     }
     */
    server.get('/users/:user/updates', (req, res, next) => {
        res.charSet('utf-8');

        const schema = Joi.object().keys({
            user: Joi.string()
                .hex()
                .lowercase()
                .length(24)
                .required(),
            'Last-Event-ID': Joi.string()
                .hex()
                .lowercase()
                .length(24)
        });

        if (req.header('Last-Event-ID')) {
            req.params['Last-Event-ID'] = req.header('Last-Event-ID');
        }

        const result = Joi.validate(req.params, schema, {
            abortEarly: false,
            convert: true
        });

        if (result.error) {
            res.json({
                error: result.error.message
            });
            return next();
        }

        let user = new ObjectID(result.value.user);
        let lastEventId = result.value['Last-Event-ID'] ? new ObjectID(result.value['Last-Event-ID']) : false;

        db.users.collection('users').findOne(
            {
                _id: user
            },
            {
                fields: {
                    username: true,
                    address: true
                }
            },
            (err, userData) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message
                    });
                    return next();
                }
                if (!userData) {
                    res.json({
                        error: 'This user does not exist'
                    });
                    return next();
                }

                let session = {
                    id: 'api.' + base32.encode(crypto.randomBytes(10)).toLowerCase(),
                    user: {
                        id: userData._id,
                        username: userData.username
                    }
                };

                let closed = false;
                let idleTimer = false;
                let idleCounter = 0;

                let sendIdleComment = () => {
                    clearTimeout(idleTimer);
                    if (closed) {
                        return;
                    }
                    res.write(': idling ' + ++idleCounter + '\n\n');
                    idleTimer = setTimeout(sendIdleComment, 15 * 1000);
                };

                let resetIdleComment = () => {
                    clearTimeout(idleTimer);
                    if (closed) {
                        return;
                    }
                    idleTimer = setTimeout(sendIdleComment, 15 * 1000);
                };

                let journalReading = false;
                let journalReader = () => {
                    if (journalReading || closed) {
                        return;
                    }
                    journalReading = true;
                    loadJournalStream(db, req, res, user, lastEventId, (err, info) => {
                        if (err) {
                            // ignore?
                        }
                        lastEventId = info && info.lastEventId;
                        journalReading = false;
                        if (info && info.processed) {
                            resetIdleComment();
                        }
                    });
                };

                let close = () => {
                    closed = true;
                    clearTimeout(idleTimer);
                    notifier.removeListener(session, '*', journalReader);
                };

                let setup = () => {
                    notifier.addListener(session, '*', journalReader);

                    let finished = false;
                    let done = () => {
                        if (finished) {
                            return;
                        }
                        finished = true;
                        close();
                        return next();
                    };

                    req.connection.setTimeout(30 * 60 * 1000, done);
                    req.connection.on('end', done);
                    req.connection.on('error', done);
                };

                res.writeHead(200, { 'Content-Type': 'text/event-stream' });

                if (lastEventId) {
                    loadJournalStream(db, req, res, user, lastEventId, (err, info) => {
                        if (err) {
                            res.write('event: error\ndata: ' + err.message.split('\n').join('\ndata: ') + '\n\n');
                            // ignore
                        }
                        setup();
                        if (info && info.processed) {
                            resetIdleComment();
                        } else {
                            sendIdleComment();
                        }
                    });
                } else {
                    db.database.collection('journal').findOne({ user }, { sort: { _id: -1 } }, (err, latest) => {
                        if (!err && latest) {
                            lastEventId = latest._id;
                        }
                        setup();
                        sendIdleComment();
                    });
                }
            }
        );
    });
};

function formatJournalData(e) {
    let data = {};
    Object.keys(e).forEach(key => {
        if (!['_id', 'ignore', 'user', 'modseq', 'unseenChange', 'created'].includes(key)) {
            if (e.command !== 'COUNTERS' && key === 'unseen') {
                return;
            }
            data[key] = e[key];
        }
    });

    let response = [];
    response.push(
        'data: ' +
            JSON.stringify(data, false, 2)
                .split('\n')
                .join('\ndata: ')
    );
    if (e._id) {
        response.push('id: ' + e._id.toString());
    }

    return response.join('\n') + '\n\n';
}

function loadJournalStream(db, req, res, user, lastEventId, done) {
    let query = { user };
    if (lastEventId) {
        query._id = { $gt: lastEventId };
    }

    let mailboxes = new Set();

    let cursor = db.database
        .collection('journal')
        .find(query)
        .sort({ _id: 1 });
    let processed = 0;
    let processNext = () => {
        cursor.next((err, e) => {
            if (err) {
                return done(err);
            }
            if (!e) {
                return cursor.close(() => {
                    if (!mailboxes.size) {
                        return done(null, {
                            lastEventId,
                            processed
                        });
                    }

                    mailboxes = Array.from(mailboxes);
                    let mailboxPos = 0;
                    let emitCounters = () => {
                        if (mailboxPos >= mailboxes.length) {
                            return done(null, {
                                lastEventId,
                                processed
                            });
                        }
                        let mailbox = new ObjectID(mailboxes[mailboxPos++]);
                        tools.getMailboxCounter(db, mailbox, false, (err, total) => {
                            if (err) {
                                // ignore
                            }
                            tools.getMailboxCounter(db, mailbox, 'unseen', (err, unseen) => {
                                if (err) {
                                    // ignore
                                }

                                res.write(
                                    formatJournalData({
                                        command: 'COUNTERS',
                                        _id: lastEventId,
                                        mailbox,
                                        total,
                                        unseen
                                    })
                                );

                                setImmediate(emitCounters);
                            });
                        });
                    };
                    emitCounters();
                });
            }

            lastEventId = e._id;

            if (!e || !e.command) {
                // skip
                return processNext();
            }

            switch (e.command) {
                case 'EXISTS':
                case 'EXPUNGE':
                    if (e.mailbox) {
                        mailboxes.add(e.mailbox.toString());
                    }
                    break;
                case 'FETCH':
                    if (e.mailbox && (e.unseen || e.unseenChange)) {
                        mailboxes.add(e.mailbox.toString());
                    }
                    break;
            }

            res.write(formatJournalData(e));

            processed++;
            processNext();
        });
    };

    processNext();
}
