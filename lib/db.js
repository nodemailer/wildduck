'use strict';

const config = require('config');
const tools = require('./tools');
const mongodb = require('mongodb');
const redis = require('redis');
const MongoClient = mongodb.MongoClient;

module.exports.database = false;
module.exports.redis = false;

module.exports.connect = callback => {
    MongoClient.connect(config.mongo, (err, database) => {
        if (err) {
            return callback(err);
        }
        module.exports.database = database;
        module.exports.redis = redis.createClient(tools.redisConfig(config.redis));
        callback(null, database);
    });
};
