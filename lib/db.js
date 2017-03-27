'use strict';

const config = require('config');
const mongodb = require('mongodb');
const MongoClient = mongodb.MongoClient;

module.exports.database = false;

module.exports.connect = callback => {
    MongoClient.connect(config.mongo, (err, database) => {
        if (err) {
            return callback(err);
        }
        module.exports.database = database;
        callback(null, database);
    });
};
