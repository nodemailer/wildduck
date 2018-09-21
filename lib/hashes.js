'use strict';

const bcrypt = require('bcryptjs');
const pbkdf2 = require('@phc/pbkdf2'); // see https://www.npmjs.com/package/@phc/pbkdf2
// this crap is only needed to support legacy users imported from some older system
const cryptMD5 = require('./md5/cryptmd5').cryptMD5;
const consts = require('./consts');

// just pass hashing through to bcrypt
module.exports.hash = (password, callback) => {
    switch (consts.DEFAULT_HASH_ALGO) {
        case 'pbkdf2':
            return pbkdf2
                .hash(password, {
                    iterations: consts.PDKDF2_ITERATIONS,
                    saltSize: consts.PDKDF2_SALT_SIZE,
                    digest: consts.PDKDF2_DIGEST
                })
                .then(hash => callback(null, hash))
                .catch(callback);

        case 'bcrypt':
        default:
            return bcrypt.hash(password, consts.BCRYPT_ROUNDS, callback);
    }
};

// compare against known hashing algos
module.exports.compare = (password, hash, callback) => {
    let algo = [].concat((hash || '').toString().match(/^\$([^$]+)\$/) || [])[1];

    switch ((algo || '').toString().toLowerCase()) {
        case 'pbkdf2-sha512':
        case 'pbkdf2-sha256':
        case 'pbkdf2-sha1':
            return pbkdf2
                .verify(hash, password)
                .then(result => callback(null, result))
                .catch(callback);

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

module.exports.shouldRehash = hash => {
    let algo = [].concat((hash || '').toString().match(/^\$([^$]+)\$/) || [])[1];

    switch ((algo || '').toString().toLowerCase()) {
        case 'pbkdf2-sha512':
        case 'pbkdf2-sha256':
        case 'pbkdf2-sha1':
            return consts.DEFAULT_HASH_ALGO !== 'pbkdf2';

        case '2a':
        case '2b':
        case '2y':
            return consts.DEFAULT_HASH_ALGO !== 'bcrypt';

        case '1': {
            return consts.DEFAULT_HASH_ALGO !== 'md5-crypt';
        }

        default:
            return false;
    }
};
