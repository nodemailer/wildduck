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
            return res.json({
                error: 'MongoDB Error: ' + err.message,
                username
            });
        }
        if (user) {
            return res.json({
                error: 'This username already exists',
                username
            });
        }

        let hash = bcrypt.hashSync(password, 8);
        database.collection('users').insertOne({
            username,
            password: hash
        }, (err, result) => {
            if (err) {
                return res.json({
                    error: 'MongoDB Error: ' + err.message,
                    username
                });
            }

            let uidValidity = Math.floor(Date.now() / 1000);

            database.collection('mailboxes').insertMany([{
                username,
                path: 'INBOX',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true
            }, {
                username,
                path: 'Sent Mail',
                specialUse: '\\Sent',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true
            }, {
                username,
                path: 'Trash',
                specialUse: '\\Trash',
                uidValidity,
                uidNext: 1,
                modifyIndex: 0,
                subscribed: true
            }, {
                username,
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
                    return res.json({
                        error: 'MongoDB Error: ' + err.message,
                        username
                    });
                }

                res.json({
                    success: true,
                    id: result.insertedId,
                    username
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
