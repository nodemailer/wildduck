'use strict';

let bcrypt = require('bcryptjs');

// this crap is only needed to support legacy users imported from some older system
let cryptMD5 = require('./md5/cryptmd5').cryptMD5;

// just pass hashing through to bcrypt
module.exports.hash = (...args) => bcrypt.hash(...args);

// compare against known hashing algos
module.exports.compare = (password, hash, callback) => {
    let algo = [].concat((hash || '').toString().match(/^\$([^$]+)\$/) || [])[1];
    switch ((algo || '').toString().toLowerCase()) {
        case '2a':
        case '2b':
        case '2y':
            return bcrypt.compare(password, hash, callback);
        case '1': {
            let result;
            try {
                let salt = hash.split('$')[2] || '';
                result = cryptMD5(password, salt) === hash;
            } catch (err) {
                return callback(err);
            }
            return callback(null, result);
        }
        default:
            return callback(new Error('Invalid algo: ' + JSON.stringify(algo)));
    }
};
