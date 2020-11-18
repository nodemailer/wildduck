'use strict';

const log = require('npmlog');
const db = require('../db');
const consts = require('../consts');

const BATCH_SIZE = 200;

let run = async taskData => {
    let cursor = await db.users.collection('messages').find(
        {
            user: taskData.user,
            userDeleted: { $ne: true }
        },
        {
            projection: {
                _id: true
            }
        }
    );

    let rdate = new Date(Date.now() + consts.DELETED_USER_MESSAGE_RETENTION).getTime();

    let messageData;
    let updateEntries = [];

    let executeBatchUpdate = async () => {
        await db.database.collection('messages').bulkWrite(updateEntries, {
            ordered: false,
            w: 1
        });
        log.verbose('Tasks', 'task=user-delete id=%s user=%s message=%s', taskData._id, taskData.user, `Marked ${updateEntries.length} messages for deletion`);
        updateEntries = [];
    };

    try {
        while ((messageData = await cursor.next())) {
            updateEntries.push({
                updateOne: {
                    filter: {
                        _id: messageData._id
                    },
                    update: {
                        $set: {
                            exp: true,
                            rdate,
                            userDeleted: true
                        }
                    }
                }
            });

            if (updateEntries.length >= BATCH_SIZE) {
                try {
                    await executeBatchUpdate();
                } catch (err) {
                    await cursor.close();
                    throw err;
                }
            }
        }
        await cursor.close();
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to fetch messages', err.message);
        err.code = 'InternalDatabaseError';
        throw err;
    }

    if (updateEntries.length) {
        await executeBatchUpdate();
    }

    try {
        await db.database.collection('mailboxes').deleteMany({ user: taskData.user });
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete mailboxes', err.message);
        err.code = 'InternalDatabaseError';
        throw err;
    }

    try {
        await db.users.collection('asps').deleteMany({ user: taskData.user });
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete asps', err.message);
        err.code = 'InternalDatabaseError';
        throw err;
    }

    try {
        await db.users.collection('filters').deleteMany({ user: taskData.user });
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete filters', err.message);
        err.code = 'InternalDatabaseError';
        throw err;
    }

    try {
        await db.users.collection('autoreplies').deleteMany({ user: taskData.user });
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete autoreplies', err.message);
        err.code = 'InternalDatabaseError';
        throw err;
    }

    try {
        // Should this run in a batch instead? Might have quite a lot of addresses tracked
        await db.database.collection('addressregister').deleteMany({ user: taskData.user });
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete autoreplies', err.message);
        err.code = 'InternalDatabaseError';
        throw err;
    }

    log.verbose('Tasks', 'task=user-delete id=%s user=%s message=%s', taskData._id, taskData.user, `Cleared user specific data`);
    return true;
};

module.exports = (taskData, options, callback) => {
    run(taskData)
        .then(response => callback(null, response))
        .catch(callback);
};
