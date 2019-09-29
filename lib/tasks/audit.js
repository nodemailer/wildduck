'use strict';

const log = require('npmlog');
const db = require('../db');

let run = async (taskData, options) => {
    const messageHandler = options.messageHandler;
    const auditHandler = options.auditHandler;

    let query = {
        user: taskData.user
    };

    if (taskData.start) {
        let start = taskData.start;
        if (['number', 'string'].includes(typeof start)) {
            start = new Date(start);
        }
        query.idate = query.idate || {};
        query.idate.$gte = start;
    }

    if (taskData.end) {
        let end = taskData.end;
        if (['number', 'string'].includes(typeof end)) {
            end = new Date(end);
        }
        query.idate = query.idate || {};
        query.idate.$lte = end;
    }

    let processMessage = async messageData => {
        let builder = messageHandler.indexer.rebuild(messageData.mimeTree);
        if (!builder || builder.type !== 'stream' || !builder.value) {
            return false;
        }

        let auditMessage = await auditHandler.store(taskData.audit, builder.value, {
            date: messageData.idate,
            msgid: messageData.msgid,
            header: messageData.mimeTree && messageData.mimeTree.parsedHeader,
            ha: messageData.ha,
            info: messageData.meta
        });

        return auditMessage;
    };

    let copied = 0;
    let failed = 0;
    let status = 'imported'; //expect to complete successfully

    let processMessages = async collection => {
        let cursor = await db.users.collection(collection).find(query, {
            projection: {
                _id: true,
                user: true,
                mimeTree: true
            }
        });

        let messageData;
        try {
            while ((messageData = await cursor.next())) {
                try {
                    let auditMessage = await processMessage(messageData);
                    log.verbose(
                        'Tasks',
                        'task=audit id=%s user=%s coll=%s message=%s src=%s dst=%s',
                        taskData._id,
                        taskData.user,
                        collection,
                        'Stored message to audit base',
                        messageData._id,
                        auditMessage
                    );
                    copied++;
                } catch (err) {
                    log.error(
                        'Tasks',
                        'task=audit id=%s user=%s coll=%s message=%s error=%s',
                        taskData._id,
                        taskData.user,
                        collection,
                        'Failed to process message',
                        err.message
                    );
                    failed++;
                }
            }
            await cursor.close();
        } catch (err) {
            log.error(
                'Tasks',
                'task=audit id=%s user=%s coll=%s message=%s error=%s',
                taskData._id,
                taskData.user,
                collection,
                'Failed to fetch stored messages',
                err.message
            );

            err.code = 'InternalDatabaseError';
            throw err;
        }
    };

    try {
        await processMessages('messages');
    } catch (err) {
        status = 'import failed';
    }

    try {
        await processMessages('archive');
    } catch (err) {
        status = 'import failed';
    }

    await db.database.collection('audits').updateOne(
        { _id: taskData.audit },
        {
            $set: {
                'import.status': status,
                'import.copied': copied,
                'import.failed': failed
            }
        }
    );

    log.verbose('Tasks', 'task=audit id=%s user=%s message=%s', taskData._id, taskData.user, `Copied user messages for auditing`);
    return true;
};

module.exports = (taskData, options, callback) => {
    run(taskData, options)
        .then(response => callback(null, response))
        .catch(callback);
};
