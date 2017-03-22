'use strict';

const config = require('config');
const restify = require('restify');
const log = require('npmlog');
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const tools = require('./lib/tools');
const ObjectID = require('mongodb').ObjectID;

let database;

const server = restify.createServer();

server.use(restify.bodyParser({
    maxBodySize: 0,
    mapParams: true,
    mapFiles: false,
    overrideParams: false
}));

server.post('/user/create', (req, res, next) => {
    const schema = Joi.object().keys({
        username: Joi.string().email().required(),
        password: Joi.string().min(3).max(100).required()
    });

    let username = req.params.username;

    const result = Joi.validate({
        username: username.replace(/[\u0080-\uFFFF]/g, 'x'),
        password: req.params.password
    }, schema, {
        abortEarly: false,
        convert: true,
        allowUnknown: true
    });

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    username = tools.normalizeAddress(username);
    let password = result.value.password;

    if (username.indexOf('+') >= 0) {
        res.json({
            error: 'Username can not contain +'
        });
        return next();
    }

    database.collection('users').findOne({
        username
    }, (err, user) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }
        if (user) {
            res.json({
                error: 'This username already exists',
                username
            });
            return next();
        }

        database.collection('addresses').findOne({
            address: username
        }, (err, address) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    address: username
                });
                return next();
            }
            if (address) {
                res.json({
                    error: 'This email address already exists',
                    address: username
                });
                return next();
            }

            // Insert
            let hash = bcrypt.hashSync(password, 11);
            database.collection('users').insertOne({
                username,
                password: hash,
                created: new Date()
            }, (err, result) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        username
                    });
                    return next();
                }

                let userId = result.insertedId;

                // insert address to email address registry
                database.collection('addresses').insertOne({
                    user: userId,
                    address: username,
                    created: new Date()
                }, err => {
                    if (err) {
                        res.json({
                            error: 'MongoDB Error: ' + err.message,
                            username
                        });
                        return next();
                    }

                    // create folders for user
                    let uidValidity = Math.floor(Date.now() / 1000);
                    database.collection('mailboxes').insertMany([{
                        user: userId,
                        path: 'INBOX',
                        uidValidity,
                        uidNext: 1,
                        modifyIndex: 0,
                        subscribed: true
                    }, {
                        user: userId,
                        path: 'Sent Mail',
                        specialUse: '\\Sent',
                        uidValidity,
                        uidNext: 1,
                        modifyIndex: 0,
                        subscribed: true
                    }, {
                        user: userId,
                        path: 'Trash',
                        specialUse: '\\Trash',
                        uidValidity,
                        uidNext: 1,
                        modifyIndex: 0,
                        subscribed: true
                    }, {
                        user: userId,
                        path: 'Junk',
                        specialUse: '\\Junk',
                        uidValidity,
                        uidNext: 1,
                        modifyIndex: 0,
                        subscribed: true
                    }], {
                        w: 1,
                        ordered: false
                    }, err => {
                        if (err) {
                            res.json({
                                error: 'MongoDB Error: ' + err.message,
                                username
                            });
                            return next();
                        }

                        res.json({
                            success: true,
                            id: userId,
                            username
                        });

                        return next();
                    });
                });
            });
        });
    });
});

server.post('/user/alias/create', (req, res, next) => {
    const schema = Joi.object().keys({
        user: Joi.string().hex().length(24).required(),
        alias: Joi.string().email().required()
    });

    let userId = req.params.user;
    let alias = req.params.alias;

    const result = Joi.validate({
        user: userId,
        alias: alias.replace(/[\u0080-\uFFFF]/g, 'x')
    }, schema, {
        abortEarly: false,
        convert: true,
        allowUnknown: true
    });

    if (result.error) {
        res.json({
            error: result.error.message
        });
        return next();
    }

    userId = new ObjectID(userId);
    alias = tools.normalizeAddress(alias);

    if (alias.indexOf('+') >= 0) {
        res.json({
            error: 'Address can not contain +'
        });
        return next();
    }

    database.collection('users').findOne({
        _id: userId
    }, (err, user) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                user: userId.toString()
            });
            return next();
        }
        if (!user) {
            res.json({
                error: 'This user does not exist',
                user: userId.toString()
            });
            return next();
        }

        database.collection('addresses').findOne({
            address: alias
        }, (err, address) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    address: alias
                });
                return next();
            }
            if (address) {
                res.json({
                    error: 'This email address already exists',
                    address: alias
                });
                return next();
            }


            // insert alias address to email address registry
            database.collection('addresses').insertOne({
                user: userId,
                address: alias,
                created: new Date()
            }, (err, result) => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        address: alias
                    });
                    return next();
                }

                res.json({
                    success: true,
                    id: result.insertedId,
                    alias
                });

                return next();
            });
        });
    });
});

module.exports = done => {
    MongoClient.connect(config.mongo, (err, mongo) => {
        if (err) {
            log.error('LMTP', 'Could not initialize MongoDB: %s', err.message);
            return;
        }
        database = mongo;

        let started = false;

        server.on('error', err => {
            if (!started) {
                started = true;
                return done(err);
            }
            log.error('API', err);
        });

        server.listen(config.api.port, config.api.host, () => {
            if (started) {
                return server.close();
            }
            started = true;
            log.info('API', 'Server listening on %s:%s', config.api.host || '0.0.0.0', config.api.port);
            done(null, server);
        });
    });
};
