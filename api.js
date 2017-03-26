'use strict';

const config = require('config');
const restify = require('restify');
const log = require('npmlog');
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const tools = require('./lib/tools');

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
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        password: Joi.string().min(3).max(100).required(),
        storage: Joi.number().default(0)
    });

    const result = Joi.validate({
        username: req.params.username,
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

    let username = result.value.username;
    let password = result.value.password;
    let storage = result.value.storage;

    database.collection('users').findOne({
        username
    }, (err, userData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }
        if (userData) {
            res.json({
                error: 'This username already exists',
                username
            });
            return next();
        }

        // Insert
        let hash = bcrypt.hashSync(password, 11);
        database.collection('users').insertOne({
            username,
            password: hash,
            address: false,
            storageUsed: 0,
            messages: 0,
            storage,
            created: new Date()
        }, (err, result) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    username
                });
                return next();
            }

            let user = result.insertedId;

            // create folders for user
            let uidValidity = Math.floor(Date.now() / 1000);
            database.collection('mailboxes').insertMany([{
                user,
                path: 'INBOX',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                storageUsed: 0,
                messages: 0,
                subscribed: true
            }, {
                user,
                path: 'Sent Mail',
                specialUse: '\\Sent',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                storageUsed: 0,
                messages: 0,
                subscribed: true
            }, {
                user,
                path: 'Trash',
                specialUse: '\\Trash',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                storageUsed: 0,
                messages: 0,
                subscribed: true
            }, {
                user,
                path: 'Junk',
                specialUse: '\\Junk',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                storageUsed: 0,
                messages: 0,
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
                    username
                });

                return next();
            });
        });
    });
});

server.post('/user/address/create', (req, res, next) => {
    const schema = Joi.object().keys({
        username: Joi.string().alphanum().lowercase().min(3).max(30).required(),
        address: Joi.string().email().required(),
        main: Joi.boolean().truthy(['Y', 'true', 'yes', 1]).optional()
    });

    let username = req.params.username;
    let address = req.params.address;
    let main = req.params.main;

    const result = Joi.validate({
        username,
        address: (address || '').replace(/[\u0080-\uFFFF]/g, 'x'),
        main
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

    username = result.value.username;
    address = tools.normalizeAddress(address);
    main = result.value.main;

    if (address.indexOf('+') >= 0) {
        res.json({
            error: 'Address can not contain +'
        });
        return next();
    }

    database.collection('users').findOne({
        username
    }, (err, userData) => {
        if (err) {
            res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
            return next();
        }
        if (!userData) {
            res.json({
                error: 'This user does not exist',
                username
            });
            return next();
        }

        database.collection('addresses').findOne({
            address
        }, (err, addressData) => {
            if (err) {
                res.json({
                    error: 'MongoDB Error: ' + err.message,
                    username,
                    address
                });
                return next();
            }
            if (addressData) {
                res.json({
                    error: 'This email address already exists',
                    username,
                    address
                });
                return next();
            }

            // insert alias address to email address registry
            database.collection('addresses').insertOne({
                user: userData._id,
                address,
                created: new Date()
            }, err => {
                if (err) {
                    res.json({
                        error: 'MongoDB Error: ' + err.message,
                        address
                    });
                    return next();
                }

                let done = () => {
                    res.json({
                        success: true,
                        username,
                        address
                    });
                    return next();
                };

                if (!userData.address || main) {
                    // register this address as the default address for that user
                    return database.collection('users').findOneAndUpdate({
                        _id: userData._id
                    }, {
                        $set: {
                            address
                        }
                    }, {}, done);
                }

                done();
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
