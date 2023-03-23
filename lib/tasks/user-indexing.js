'use strict';

const log = require('npmlog');
const db = require('../db');

let run = async (task, data, options) => {
    const backlogIndexingQueue = options.backlogIndexingQueue;

    let hasFeatureFlag = await db.redis.sismember(`feature:indexing`, data.user.toString());

    if (!hasFeatureFlag) {
        log.silly('Tasks', 'task=user-indexing id=%s Feature flag not set, skipping user=%s command=%s', task._id, data.user.toString(), 'backlog');
        return;
    } else {
        log.verbose('Tasks', 'task=user-indexing id=%s Feature flag set, processing user=%s command=%s', task._id, data.user.toString(), 'backlog');
    }

    let cursor = await db.database.collection('messages').find(
        {
            user: data.user
        },
        {
            projection: {
                _id: true,
                mailbox: true,
                uid: true,
                modseq: true
            }
        }
    );

    let messages = 0;

    let messageData;
    while ((messageData = await cursor.next())) {
        let hasFeatureFlag = await db.redis.sismember(`feature:indexing`, data.user.toString());
        if (!hasFeatureFlag) {
            log.verbose(
                'Tasks',
                'task=user-indexing id=%s Aborted user indexing, feature flag disabled user=%s messages=%s',
                task._id,
                data.user.toString(),
                messages
            );
            await cursor.close();
            return;
        }

        let payload = {
            action: 'new',
            message: messageData._id.toString(),
            mailbox: messageData.mailbox.toString(),
            uid: messageData.uid,
            modseq: messageData.modseq
        };

        await backlogIndexingQueue.add('backlog', payload, {
            removeOnComplete: 100,
            removeOnFail: 100,
            attempts: 5,
            backoff: {
                type: 'exponential',
                delay: 2000
            }
        });

        messages++;
    }
    await cursor.close();

    log.verbose('Tasks', 'task=user-indexing id=%s User messages queued for indexing user=%s messages=%s', task._id, data.user.toString(), messages);
};

module.exports = (task, data, options, callback) => {
    run(task, data, options)
        .then(result => callback(null, result))
        .catch(err => {
            log.error('Tasks', 'task=user-indexing id=%s user=%s error=%s', task._id, data.user, err.stack);
            callback(err);
        });
};
