'use strict';

const config = require('config');
const restify = require('restify');
const log = require('npmlog');
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;
const Joi = require('joi');
const bcrypt = require('bcryptjs');
const punycode = require('punycode');

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

    const result = Joi.validate(req.params, schema, {
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

    let username = normalizeAddress(result.value.username);
    let password = result.value.password;

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

function normalizeAddress(address, withNames) {
    if (typeof address === 'string') {
        address = {
            address
        };
    }
    if (!address || !address.address) {
        return '';
    }
    let user = address.address.substr(0, address.address.lastIndexOf('@'));
    let domain = address.address.substr(address.address.lastIndexOf('@') + 1);
    let addr = user.trim() + '@' + punycode.toASCII(domain.toLowerCase().trim());

    if (withNames) {
        return {
            name: address.name || '',
            address: addr
        };
    }

    return addr;
}

module.exports = (imap, done) => {
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
