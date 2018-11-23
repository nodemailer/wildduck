'use strict';

const log = require('npmlog');
const db = require('../db');

module.exports = (taskData, options, callback) => {
    let cursor = db.users
        .collection('users')
        .find({})
        .project({ _id: true, storageUsed: true });

    let processNext = () => {
        cursor.next((err, userData) => {
            if (err) {
                log.error('Tasks', 'task=quota id=%s error=%s', taskData._id, err.message);
                return callback(err);
            }

            if (!userData) {
                return cursor.close(() => callback(null, true));
            }

            db.database
                .collection('messages')
                .aggregate([
                    {
                        $match: {
                            user: userData._id
                        }
                    },
                    {
                        $group: {
                            _id: {
                                user: '$user'
                            },
                            storageUsed: {
                                $sum: '$size'
                            }
                        }
                    }
                ])
                .toArray((err, storageData) => {
                    if (err) {
                        log.error('Tasks', 'task=quota id=%s user=%s error=%s', taskData._id, userData._id, err.message);
                        return setTimeout(processNext, 5000);
                    }

                    let storageUsed = (storageData && storageData[0] && storageData[0].storageUsed) || 0;
                    if (storageUsed === userData.storageUsed) {
                        log.info(
                            'Tasks',
                            'task=quota id=%s user=%s stored=%s calculated=%s updated=%s',
                            taskData._id,
                            userData._id,
                            userData.storageUsed,
                            storageUsed,
                            'no'
                        );
                        return setImmediate(processNext);
                    }

                    db.users.collection('users').updateOne(
                        {
                            _id: userData._id
                        },
                        {
                            $set: {
                                storageUsed: Number(storageUsed) || 0
                            }
                        },
                        (err, r) => {
                            if (err) {
                                log.error('Tasks', 'task=quota id=%s user=%s error=%s', taskData._id, userData._id, err.message);
                                return setTimeout(processNext, 5000);
                            }
                            log.info(
                                'Tasks',
                                'task=quota id=%s user=%s stored=%s calculated=%s updated=%s',
                                taskData._id,
                                userData._id,
                                userData.storageUsed,
                                storageUsed,
                                r.modifiedCount ? 'yes' : 'no'
                            );
                            return setImmediate(processNext);
                        }
                    );
                });
        });
    };

    processNext();
};
