'use strict';

const config = require('config');
const tools = require('./tools');
const mongodb = require('mongodb');
const redis = require('redis');
const MongoClient = mongodb.MongoClient;

module.exports.forwarder = false;
module.exports.database = false;
module.exports.redis = false;

module.exports.connect = callback => {
    MongoClient.connect(config.mongo, (err, database) => {
        if (err) {
            return callback(err);
        }
        module.exports.database = database;
        module.exports.redis = redis.createClient(tools.redisConfig(config.redis));

        if (!config.forwarder.enabled) {
            return callback(null, database);
        }

        if (!config.forwarder.mongo) {
            module.exports.forwarder = database;
            return callback(null, database);
        }

        MongoClient.connect(config.forwarder.mongo, (err, forwarderDatabase) => {
            if (err) {
                database.close();
                return callback(err);
            }
            module.exports.forwarder = forwarderDatabase;
            return callback(null, database);
        });
    });
};
