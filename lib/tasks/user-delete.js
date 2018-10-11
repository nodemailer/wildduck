'use strict';

const log = require('npmlog');
const db = require('../db');
const consts = require('../consts');

module.exports = (taskData, options, callback) => {
    // keep messages around for a while, delete other stuff

    let processMessages = done => {
        db.database.collection('messages').updateMany(
            { user: taskData.user },
            {
                $set: {
                    exp: true,
                    rdate: new Date(Date.now() + consts.DELETED_USER_MESSAGE_RETENTION),
                    userDeleted: true
                }
            },
            err => {
                if (err) {
                    log.error(
                        'Tasks',
                        'task=user-delete id=%s user=%s message=%s error=%s',
                        taskData._id,
                        taskData.user,
                        'Failed to update messages',
                        err.message
                    );
                    err.code = 'InternalDatabaseError';
                    return callback(err);
                }
                done();
            }
        );
    };

    processMessages(() => {
        db.database.collection('mailboxes').deleteMany({ user: taskData.user }, err => {
            if (err) {
                log.error(
                    'Tasks',
                    'task=user-delete id=%s user=%s message=%s error=%s',
                    taskData._id,
                    taskData.user,
                    'Failed to delete mailboxes',
                    err.message
                );
                err.code = 'InternalDatabaseError';
            }

            db.users.collection('asps').deleteMany({ user: taskData.user }, err => {
                if (err) {
                    log.error('Tasks', 'task=user-delete id=%s user=%s message=%s error=%s', taskData._id, taskData.user, 'Failed to delete asps', err.message);
                    err.code = 'InternalDatabaseError';
                }

                db.users.collection('filters').deleteMany({ user: taskData.user }, err => {
                    if (err) {
                        log.error(
                            'Tasks',
                            'task=user-delete id=%s user=%s message=%s error=%s',
                            taskData._id,
                            taskData.user,
                            'Failed to delete filters',
                            err.message
                        );
                        err.code = 'InternalDatabaseError';
                    }

                    db.users.collection('autoreplies').deleteMany({ user: taskData.user }, err => {
                        if (err) {
                            log.error(
                                'Tasks',
                                'task=user-delete id=%s user=%s message=%s error=%s',
                                taskData._id,
                                taskData.user,
                                'Failed to delete autoreplies',
                                err.message
                            );
                            err.code = 'InternalDatabaseError';
                        }

                        return callback(null, true);
                    });
                });
            });
        });
    });
};
