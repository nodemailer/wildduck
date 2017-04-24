'use strict';

const config = require('config');
const tools = require('./tools');
const mongodb = require('mongodb');
const redis = require('redis');
const MongoClient = mongodb.MongoClient;

module.exports.senderDb = false;
module.exports.database = false;
module.exports.redis = false;

module.exports.connect = callback => {
    MongoClient.connect(config.mongo, (err, database) => {
        if (err) {
            return callback(err);
        }
        module.exports.database = database;
        module.exports.redis = redis.createClient(tools.redisConfig(config.redis));

        if (!config.sender.enabled) {
            return callback(null, database);
        }

        if (!config.sender.mongo) {
            module.exports.senderDb = database;
            return callback(null, database);
        }

        MongoClient.connect(config.sender.mongo, (err, forwarderDatabase) => {
            if (err) {
                database.close();
                return callback(err);
            }
            module.exports.senderDb = forwarderDatabase;
            return callback(null, database);
        });
    });
};
