'use strict';

let bcrypt = require('bcryptjs');
let md5 = require('nano-md5');

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
                result = md5.crypt(password, hash) === hash;
            } catch (err) {
                return callback(err);
            }
            return callback(null, result);
        }
        default:
            return callback(new Error('Invalid algo: ' + JSON.stringify(algo)));
    }
};
