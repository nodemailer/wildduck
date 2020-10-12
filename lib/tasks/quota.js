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

                    db.users.collection('users').findOneAndUpdate(
                        {
                            _id: userData._id
                        },
                        {
                            $set: {
                                storageUsed: Number(storageUsed) || 0
                            }
                        },
                        {
                            returnOriginal: true,
                            projection: {
                                storageUsed: true
                            }
                        },
                        (err, r) => {
                            if (err) {
                                log.error('Tasks', 'task=quota id=%s user=%s error=%s', taskData._id, userData._id, err.message);
                                return setTimeout(processNext, 5000);
                            }

                            if (r && r.value) {
                                options.loggelf({
                                    short_message: '[QUOTA] reset',
                                    _mail_action: 'quota',
                                    _user: userData._id,
                                    _set: Number(storageUsed) || 0,
                                    _previous_storage_used: r.value.storageUsed,
                                    _storage_used: Number(storageUsed) || 0,
                                    _sess: 'task.quota.' + taskData._id
                                });
                            }

                            log.info(
                                'Tasks',
                                'task=quota id=%s user=%s stored=%s calculated=%s updated=%s',
                                taskData._id,
                                userData._id,
                                userData.storageUsed,
                                storageUsed,
                                r.lastErrorObject && r.lastErrorObject.updatedExisting ? 'yes' : 'no'
                            );
                            return setImmediate(processNext);
                        }
                    );
                });
        });
    };

    processNext();
};
