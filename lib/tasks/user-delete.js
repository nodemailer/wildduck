'use strict';

const log = require('npmlog');
const db = require('../db');
const consts = require('../consts');

const { publish, USER_DELETE_COMPLETED } = require('../events');

const BATCH_SIZE = 500;

const deleteMessages = async taskData => {
    let rdate = new Date(Date.now() + consts.DELETED_USER_MESSAGE_RETENTION).getTime();
    let lastId;

    let markedAsDeleted = 0;

    try {
        let done = false;
        while (!done) {
            let query = {
                user: taskData.user,
                userDeleted: { $ne: true }
            };

            if (lastId) {
                query._id = { $gt: lastId };
            }

            let messages = await db.database
                .collection('messages')
                .find(query, {
                    sort: { _id: 1 },
                    projection: {
                        _id: true
                    },
                    limit: BATCH_SIZE
                })
                .toArray();
            if (!messages.length) {
                // all done
                done = true;
                break;
            }
            messages = messages.map(messageData => messageData._id);
            lastId = messages[messages.length - 1];

            let updateEntries = [];
            messages.forEach(message => {
                updateEntries.push({
                    updateOne: {
                        filter: {
                            _id: message
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
            });
            let bulkResult = await db.database.collection('messages').bulkWrite(updateEntries, {
                ordered: false,
                w: 1
            });

            markedAsDeleted += (bulkResult && bulkResult.modifiedCount) || 0;
        }
    } catch (err) {
        err.markedAsDeleted = markedAsDeleted;
        throw err;
    } finally {
        log.verbose('Tasks', 'task=user-delete id=%s user=%s message=%s', taskData._id, taskData.user, `Marked ${markedAsDeleted} messages for deletion`);
    }
    return markedAsDeleted;
};

const deleteRegistryAddresses = async taskData => {
    let lastId;

    let deleted = 0;

    try {
        let done = false;
        while (!done) {
            let query = {
                user: taskData.user
            };

            if (lastId) {
                query._id = { $gt: lastId };
            }

            let addresses = await db.database
                .collection('addressregister')
                .find(query, {
                    sort: { _id: 1 },
                    projection: {
                        _id: true
                    },
                    limit: BATCH_SIZE
                })
                .toArray();
            if (!addresses.length) {
                // all done
                done = true;
                break;
            }
            addresses = addresses.map(addresseData => addresseData._id);
            lastId = addresses[addresses.length - 1];

            let updateEntries = [];
            addresses.forEach(message => {
                updateEntries.push({
                    deleteOne: {
                        filter: {
                            _id: message
                        }
                    }
                });
            });
            let bulkResult = await db.database.collection('addressregister').bulkWrite(updateEntries, {
                ordered: false,
                w: 1
            });

            deleted += (bulkResult && bulkResult.deletedCount) || 0;
        }
    } catch (err) {
        err.deleted = deleted;
        throw err;
    } finally {
        log.verbose('Tasks', 'task=user-delete id=%s user=%s message=%s', taskData._id, taskData.user, `Deleted ${deleted} addresses from registry`);
    }
    return deleted;
};

const run = async taskData => {
    let result = {};

    try {
        let delRes = await db.database.collection('mailboxes').deleteMany({ user: taskData.user });
        result.mailboxes = { deleted: delRes.deletedCount };
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete mailboxes', err.message);
        err.code = 'InternalDatabaseError';
        result.mailboxes = { error: err.message };
        throw err;
    }

    try {
        let delRes = await db.users.collection('asps').deleteMany({ user: taskData.user });
        result.asps = { deleted: delRes.deletedCount };
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete asps', err.message);
        err.code = 'InternalDatabaseError';
        result.asps = { error: err.message };
        throw err;
    }

    try {
        let delRes = await db.database.collection('filters').deleteMany({ user: taskData.user });
        result.filters = { deleted: delRes.deletedCount };
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete filters', err.message);
        err.code = 'InternalDatabaseError';
        result.filters = { error: err.message };
        throw err;
    }

    try {
        let delRes = await db.database.collection('autoreplies').deleteMany({ user: taskData.user });
        result.autoreplies = { deleted: delRes.deletedCount };
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete autoreplies', err.message);
        err.code = 'InternalDatabaseError';
        result.autoreplies = { error: err.message };
        throw err;
    }

    try {
        let deleted = await deleteRegistryAddresses(taskData);
        result.addressregister = { deleted };
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete autoreplies', err.message);
        err.code = 'InternalDatabaseError';
        result.addressregister = { error: err.message, deleted: err.deleted };
        throw err;
    }

    try {
        // mark messages for deletion
        let markedAsDeleted = await deleteMessages(taskData);
        result.messages = { deleted: markedAsDeleted };
    } catch (err) {
        log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to fetch messages', err.message);
        err.code = 'InternalDatabaseError';
        result.messages = { error: err.message, deleted: err.markedAsDeleted };
        throw err;
    }

    log.verbose('Tasks', 'task=user-delete id=%s user=%s message=%s', taskData._id, taskData.user, `Cleared user specific data`);

    result.task = taskData._id.toString();

    await publish(db.redis, {
        ev: USER_DELETE_COMPLETED,
        user: taskData.user,
        result
    });

    return true;
};

module.exports = (taskData, options, callback) => {
    run(taskData)
        .then(response => callback(null, response))
        .catch(callback);
};
