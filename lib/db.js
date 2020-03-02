'use strict';

const config = require('wild-config');
const tools = require('./tools');
const mongodb = require('mongodb');
const Redis = require('ioredis');
const MongoClient = mongodb.MongoClient;

module.exports.database = false;
module.exports.gridfs = false;
module.exports.users = false;
module.exports.senderDb = false;
module.exports.redis = false;
module.exports.redisConfig = false;

let getDBConnection = (main, config, callback) => {
    if (main) {
        if (!config) {
            return callback(null, false);
        }
        if (config && !/[:/]/.test(config)) {
            return callback(null, main.db(config));
        }
    }
    MongoClient.connect(
        config,
        {
            useNewUrlParser: true,
            useUnifiedTopology: true
        },
        (err, db) => {
            if (err) {
                return callback(err);
            }
            if (main && db.s && db.s.options && db.s.options.dbName) {
                db = db.db(db.s.options.dbName);
            }
            return callback(null, db);
        }
    );
};

module.exports.connect = callback => {
    getDBConnection(false, config.dbs.mongo, (err, db) => {
        if (err) {
            return callback(err);
        }

        if (db.s && db.s.options && db.s.options.dbName) {
            module.exports.database = db.db(db.s.options.dbName);
        } else {
            module.exports.database = db;
        }

        getDBConnection(db, config.dbs.gridfs, (err, gdb) => {
            if (err) {
                return callback(err);
            }
            module.exports.gridfs = gdb || module.exports.database;

            getDBConnection(db, config.dbs.users, (err, udb) => {
                if (err) {
                    return callback(err);
                }
                module.exports.users = udb || module.exports.database;

                getDBConnection(db, config.dbs.sender, (err, sdb) => {
                    if (err) {
                        return callback(err);
                    }
                    module.exports.senderDb = sdb || module.exports.database;

                    module.exports.redisConfig = tools.redisConfig(config.dbs.redis);
                    module.exports.redis = new Redis(module.exports.redisConfig);

                    module.exports.redis.connect(() => callback(null, module.exports.database));
                });
            });
        });
    });
};
