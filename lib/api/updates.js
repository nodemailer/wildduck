'use strict';

const crypto = require('crypto');
const Joi = require('joi');
const { ObjectId } = require('mongodb');
const { failAction, getMailboxCounter } = require('../tools');
const roles = require('../roles');
const base32 = require('base32.js');
const { userIdSchema, mongoIdSchema } = require('../schemas');
const Boom = require('@hapi/boom');
const packageData = require('../../package.json');
const { Transform, finished } = require('stream');

// This is the transform stream we will be piping to output
class ResponseStream extends Transform {
    constructor(opts) {
        super();
        opts = opts || {};

        this.db = opts.db;
        this.session = opts.session;
        this.notifier = opts.notifier;

        this.user = opts.user;
        this.lastEventId = opts.lastEventId;
        this.request = opts.request;

        // should we ignore all next messages even if the stream instance is not finished yet?
        this.stoppedProcessing = false;

        this.journalReading = false;
        this.journalReader = false;

        this.periodicKeepAliveTimer = false;
        this.updateIdleTimer();

        this.finished = false;
    }

    async processIncomingMessage(message) {
        if (this.journalReading || this.stoppedProcessing) {
            return;
        }

        if (message) {
            this.sendMessage(formatJournalData(message));
            if (message.command === 'LOGOUT') {
                this.stoppedProcessing = true;
                this.end();
            }
            return;
        }

        this.journalReading = true;
        try {
            await loadJournalStream(this);
        } catch (err) {
            // ignore?
        }
        this.journalReading = false;
    }

    async setup() {
        if (!this.lastEventId) {
            this.lastEventId = await getLatestEventId(this.db, this.user);
        }

        this.journalReader = message => {
            this.processIncomingMessage(message).catch(err => {
                this.request.logger.error({ api: 'updates', msg: 'Message processing failed', user: this.user, message, err });
            });
        };

        this.notifier.addListener(this.session, this.journalReader);
        this.sendMessage(`: ${packageData.name} [${this.user}]\n\n`);
    }

    updateIdleTimer() {
        clearTimeout(this.periodicKeepAliveTimer);
        if (this.finished) {
            return;
        }
        this.periodicKeepAliveTimer = setTimeout(() => {
            if (this.finished) {
                return;
            }

            this.write(': still here\n\n');
            if (this._compressor) {
                this._compressor.flush();
            }
            this.updateIdleTimer();
        }, 90 * 1000);
        this.periodicKeepAliveTimer.unref();
    }

    setCompressor(compressor) {
        this._compressor = compressor;
    }

    sendMessage(payload) {
        if (this.finished) {
            return;
        }

        if (typeof payload === 'string') {
            this.write(payload);
        } else {
            let sendData = JSON.stringify(payload);
            this.write('event: message\ndata:' + sendData + '\n\n');
        }

        if (this._compressor) {
            this._compressor.flush();
        }

        this.updateIdleTimer();
    }

    finalize() {
        clearTimeout(this.periodicKeepAliveTimer);
        if (this.journalReader) {
            this.notifier.removeListener(this.session, this.journalReader);
            this.journalReader = null;
        }
        this.finished = true;
    }

    _transform(data, encoding, done) {
        if (this.finished) {
            return done();
        }
        this.push(data);
        done();
    }

    _flush(done) {
        if (this.finished) {
            return done();
        }
        this.finalize();
        done();
    }
}

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
    response.push('data: ' + JSON.stringify(data, false, 2).split('\n').join('\ndata: '));
    if (e._id) {
        response.push('id: ' + e._id.toString());
    }

    return response.join('\n') + '\n\n';
}

async function getLatestEventId(db, user) {
    let latestJournalEntry = await db.database.collection('journal').find({ user }).sort({ _id: -1 }).limit(1).toArray();
    return latestJournalEntry && latestJournalEntry.length ? latestJournalEntry[0]._id : false;
}

async function loadJournalStream(responseStream) {
    if (responseStream.stoppedProcessing) {
        return;
    }

    let query = { user: responseStream.user };
    if (responseStream.lastEventId) {
        query._id = { $gt: responseStream.lastEventId };
    }

    let processed = 0;
    let mailboxes = new Set();

    let cursor = await responseStream.db.database.collection('journal').find(query).sort({ _id: 1 });

    let closeConnection = false;
    let journalEntry;
    while ((journalEntry = await cursor.next())) {
        try {
            if (!journalEntry || !journalEntry.command || responseStream.stoppedProcessing) {
                // skip
                continue;
            }

            responseStream.lastEventId = journalEntry._id;

            switch (journalEntry.command) {
                case 'EXISTS':
                case 'EXPUNGE':
                    if (journalEntry.mailbox) {
                        mailboxes.add(journalEntry.mailbox.toString());
                    }
                    break;
                case 'FETCH':
                    if (journalEntry.mailbox && (journalEntry.unseen || journalEntry.unseenChange)) {
                        mailboxes.add(journalEntry.mailbox.toString());
                    }
                    break;
            }

            try {
                responseStream.sendMessage(formatJournalData(journalEntry));
            } catch (err) {
                responseStream.request.logger.error({ api: 'updates', msg: 'Failed to send event', user: responseStream.user, err });
            }

            processed++;

            if (journalEntry.command === 'LOGOUT') {
                closeConnection = true;
                responseStream.stoppedProcessing = true;
                break;
            }
        } catch (err) {
            responseStream.request.logger.error({
                api: 'updates',
                msg: 'Failed to process journal entry',
                user: responseStream.user,
                entry: journalEntry._id,
                err
            });
        }
    }

    try {
        await cursor.close();
    } catch (err) {
        responseStream.request.logger.error({
            api: 'updates',
            msg: 'Failed to close journal cursor',
            user: responseStream.user,
            err
        });
    }

    if (closeConnection || responseStream.stoppedProcessing) {
        try {
            responseStream.end();
        } catch (err) {
            responseStream.request.logger.error({
                api: 'updates',
                msg: 'Failed to close EventSource stream',
                user: responseStream.user,
                err
            });
        }
        return;
    }

    // send counter changes
    for (let mailbox of mailboxes) {
        let total, unseen;
        try {
            total = await getMailboxCounter(responseStream.db, mailbox);
            unseen = await getMailboxCounter(responseStream.db, mailbox, 'unseen');

            responseStream.sendMessage(
                formatJournalData({
                    command: 'COUNTERS',
                    _id: responseStream.lastEventId,
                    mailbox,
                    total,
                    unseen
                })
            );
        } catch (err) {
            responseStream.request.logger.error({ api: 'updates', msg: 'Failed to load counters', user: responseStream.user, mailbox, err });
        }
    }

    return {
        lastEventId: responseStream.lastEventId,
        processed
    };
}

module.exports = (server, db, notifier) => {
    server.route({
        method: 'GET',
        path: '/users/{user}/updates',

        async handler(request, h) {
            // permissions check

            // permissions check
            // should the resource be something else than 'users'?
            let permission;
            if (request.app.user && request.app.user === request.params.user) {
                permission = roles.can(request.app.role).readOwn('users');
            } else {
                permission = roles.can(request.app.role).readAny('users');
            }
            request.validateAcl(permission);

            let user = new ObjectId(request.params.user);
            let lastEventId = request.query['Last-Event-ID'] ? new ObjectId(request.query['Last-Event-ID']) : false;

            let userData;

            try {
                userData = await db.users.collection('users').findOne(
                    {
                        _id: user
                    },
                    {
                        projection: {
                            username: true,
                            address: true
                        }
                    }
                );
            } catch (err) {
                let error = Boom.boomify(new Error('MongoDB Error: ' + err.message), { statusCode: 500 });
                error.output.payload.code = 'InternalDatabaseError';
                throw error;
            }
            if (!userData) {
                let error = Boom.boomify(new Error('Requested user was not found'), { statusCode: 404 });
                error.output.payload.code = 'UserNotFound';
                throw error;
            }

            let session = {
                id: 'api.' + base32.encode(crypto.randomBytes(10)).toLowerCase(),
                user: {
                    id: userData._id,
                    username: userData.username
                }
            };

            let outputStream = new ResponseStream({
                db,
                notifier,
                session,
                user,
                lastEventId,
                request
            });
            request.app.stream = outputStream;

            finished(request.app.stream, err => request.app.stream.finalize(err));
            setImmediate(() => {
                outputStream.setup().catch(err => {
                    request.logger.error({ api: 'updates', msg: 'Stream setup failed', user, err });
                });
            });

            return h
                .response(request.app.stream)
                .header('X-Accel-Buffering', 'no')
                .header('Connection', 'keep-alive')
                .header('Cache-Control', 'no-cache')
                .type('text/event-stream');
        },

        options: {
            description: 'Open change stream',
            notes: 'This API call returns an EventSource response. Listen to this stream to get notifications about changes in messages and mailboxes. Listed events are JSON encoded strings.',
            tags: ['api', 'Users'],

            plugins: {},

            validate: {
                options: {
                    stripUnknown: false,
                    abortEarly: false,
                    convert: true
                },

                failAction,

                params: Joi.object({
                    user: userIdSchema.required()
                }).label('ResolveDkimParams'),

                query: Joi.object({
                    'Last-Event-ID': mongoIdSchema.description('Optional ID of the last known event').example('60a4284679dd36b49cda9485')
                }).label('ResolveDkimQuery')
            }
        }
    });
};
