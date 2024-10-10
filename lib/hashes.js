'use strict';

const bcrypt = require('bcryptjs');
const pbkdf2 = require('@phc/pbkdf2'); // see https://www.npmjs.com/package/@phc/pbkdf2
const unixcrypt = require('unixcrypt');
// inefficient but we are rehashing immediately after successful verification
const { argon2Verify } = require('hash-wasm');
// this crap is only needed to support legacy users imported from some older system
const cryptMD5 = require('./md5/cryptmd5').cryptMD5;
const consts = require('./consts');
const unixCryptTD = require('unix-crypt-td-js');

// just pass hashing through to bcrypt
module.exports.hash = async password => {
    password = (password || '').toString();

    switch (consts.DEFAULT_HASH_ALGO) {
        case 'pbkdf2':
            return await pbkdf2.hash(password, {
                iterations: consts.PDKDF2_ITERATIONS,
                saltSize: consts.PDKDF2_SALT_SIZE,
                digest: consts.PDKDF2_DIGEST
            });
        case 'bcrypt':
        default:
            return await bcrypt.hash(password, consts.BCRYPT_ROUNDS);
    }
};

// compare against known hashing algos
module.exports.compare = async (password, hash) => {
    password = (password || '').toString();
    hash = (hash || '').toString();

    let algo = checkHashSupport(hash);
    if (!algo.result) {
        throw new Error('Invalid algo: ' + JSON.stringify(algo.algo));
    }

    switch (algo.algo) {
        case 'pbkdf2':
            return await pbkdf2.verify(hash, password);

        case 'bcrypt':
            return await bcrypt.compare(password, hash);

        case 'unixcrypt':
            return await unixcryptCompareAsync(password, hash);

        case 'argon2':
            try {
                // throws if does not match
                return await argon2Verify({
                    password,
                    hash
                });
            } catch (err) {
                return false;
            }

        case 'md5': {
            let result;

            let salt = hash.split('$')[2] || '';
            result = cryptMD5(password, salt) === hash;

            return result;
        }

        case 'des': {
            let result;

            let salt = hash.substr(0, 2);
            result = unixCryptTD(password, salt) === hash;

            return result;
        }

        default:
            throw new Error('Invalid algo: ' + JSON.stringify(algo));
    }
};

function checkHashSupport(hash) {
    hash = (hash || '').toString();

    if (/^[0-9a-z./]{13}$/i.test(hash)) {
        // DES https://passlib.readthedocs.io/en/stable/lib/passlib.hash.des_crypt.html#format
        return { result: true, algo: 'des' };
    }

    let algo = [].concat(hash.match(/^\$([^$]+)\$/) || [])[1];
    algo = (algo || '').toString().toLowerCase();

    switch (algo) {
        case 'pbkdf2-sha512':
        case 'pbkdf2-sha256':
        case 'pbkdf2-sha1':
            return { result: true, algo: 'pbkdf2' };
        case '2a':
        case '2b':
        case '2y':
            return { result: true, algo: 'bcrypt' };
        case '6': // sha512crypt
        case '5': // sha256crypt
            return { result: true, algo: 'unixcrypt' };

        case 'argon2d':
        case 'argon2i':
        case 'argon2id':
            return { result: true, algo: 'argon2' };

        case '1': {
            return { result: true, algo: 'md5' };
        }

        default:
            return { result: false, algo };
    }
}

module.exports.checkHashSupport = checkHashSupport;

module.exports.shouldRehash = hash => {
    hash = (hash || '').toString();

    if (/^[0-9a-z./]{13}$/i.test(hash)) {
        // DES https://passlib.readthedocs.io/en/stable/lib/passlib.hash.des_crypt.html#format
        return true;
    }

    let algo = [].concat(hash.match(/^\$([^$]+)\$/) || [])[1];
    algo = (algo || '').toString().toLowerCase();

    switch (algo) {
        case 'pbkdf2-sha512':
        case 'pbkdf2-sha256': {
            let [, iterations] = hash.match(/^\$[^$]+\$i=(\d+)\$/) || [];

            if (consts.DEFAULT_HASH_ALGO !== 'pbkdf2') {
                return true;
            }

            iterations = (iterations && Number(iterations)) || 0;

            if (iterations && consts.PDKDF2_ITERATIONS > iterations) {
                return true;
            }

            return false;
        }
        case '2a':
        case '2b':
        case '2y':
            return consts.DEFAULT_HASH_ALGO !== 'bcrypt';

        // Always rehash the following algos
        case '6': // sha512crypt
        case '5': // sha256crypt
        case '1': // md5
        case 'argon2d': // Argon2 (mostly because we are using an inefficient implementation)
        case 'argon2i':
        case 'argon2id':
        case 'pbkdf2-sha1':
            return true;

        default:
            return false;
    }
};

async function unixcryptCompareAsync(password, hash) {
    password = (password || '').toString();
    hash = (hash || '').toString();

    return unixcrypt.verify(password, hash);
}
