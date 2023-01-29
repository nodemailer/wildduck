'use strict';

const log = require('npmlog');
const db = require('../db');
const util = require('util');
const prepareSearchFilter = require('../prepare-search-filter');
const ObjectId = require('mongodb').ObjectId;

let run = async (task, data, options) => {
    const messageHandler = options.messageHandler;

    const moveMessage = util.promisify(messageHandler.move.bind(messageHandler));
    const updateMessage = util.promisify(messageHandler.update.bind(messageHandler));

    let updated = 0;
    let errors = 0;

    const user = new ObjectId(data.user);

    const action = data.action || {};
    if (action.moveTo) {
        action.moveTo = new ObjectId(action.moveTo);
    }

    const { query, filter } = await prepareSearchFilter(db, user, data);

    try {
        // getMailboxAsync throws if mailbox is missing or wrong owner
        const mailboxData = action.moveTo ? await messageHandler.getMailboxAsync({ mailbox: action.moveTo }) : false;

        let updates = {};
        for (let key of ['seen', 'flagged']) {
            if (key in action) {
                updates[key] = action[key];
            }
        }

        let cursor = await db.database.collection('messages').find(filter);

        let messageData;

        if (!action.moveTo && !Object.keys(updates).length) {
            // nothing to do here
            return;
        }

        while ((messageData = await cursor.next())) {
            if (!messageData || messageData.user.toString() !== user.toString()) {
                continue;
            }

            if (action.moveTo && action.moveTo.toString() !== messageData.mailbox.toString()) {
                try {
                    await moveMessage({
                        user,
                        source: {
                            user: messageData.user,
                            mailbox: messageData.mailbox
                        },
                        destination: {
                            mailbox: mailboxData._id
                        },
                        updates: Object.keys(updates).length ? updates : false,
                        messageQuery: messageData.uid
                    });
                    updated++;
                } catch (err) {
                    errors++;
                    log.error(
                        'Tasks',
                        'task=search-apply id=%s user=%s query=%s message=%s error=%s',
                        task._id,
                        data.user,
                        JSON.stringify(query),
                        messageData._id,
                        err.message
                    );
                }
            } else if (Object.keys(updates).length) {
                try {
                    updated += await updateMessage(user, messageData.mailbox, messageData.uid, updates);
                } catch (err) {
                    errors++;
                    log.error(
                        'Tasks',
                        'task=search-apply id=%s user=%s query=%s message=%s error=%s',
                        task._id,
                        data.user,
                        JSON.stringify(query),
                        messageData._id,
                        err.message
                    );
                }
            }
        }
        await cursor.close();
    } catch (err) {
        log.error('Tasks', 'task=search-apply id=%s user=%s error=%s', task._id, data.user, err.stack);
        // best effort, do not throw
    } finally {
        log.verbose('Tasks', 'task=search-apply id=%s user=%s query=%s updated=%s errors=%s', task._id, data.user, JSON.stringify(query), updated, errors);
    }
};

module.exports = (task, data, options, callback) => {
    run(task, data, options)
        .then(result => callback(null, result))
        .catch(err => {
            log.error('Tasks', 'task=search-apply id=%s user=%s error=%s', task._id, data.user, err.stack);
            callback(err);
        });
};
