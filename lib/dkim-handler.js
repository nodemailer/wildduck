'use strict';

const ObjectID = require('mongodb').ObjectID;
const fingerprint = require('key-fingerprint').fingerprint;
const forge = require('node-forge');
const crypto = require('crypto');
const tools = require('./tools');
const pem = require('pem');

class DkimHandler {
    constructor(options) {
        options = options || {};
        this.cipher = options.cipher;
        this.secret = options.secret;

        this.useOpenSSL = !!options.useOpenSSL;

        if (options.pathOpenSSL) {
            pem.config({
                pathOpenSSL: options.pathOpenSSL
            });
        }

        this.database = options.database;
    }

    set(options, callback) {
        const domain = tools.normalizeDomain(options.domain);
        const selector = options.selector;
        const description = options.description;

        let privateKeyPem = options.privateKey;
        let publicKeyPem;

        let getPrivateKey = done => {
            if (privateKeyPem) {
                return done();
            }

            // private key not set, generate a new key

            if (this.useOpenSSL) {
                return pem.createPrivateKey(2048, {}, (err, result) => {
                    if (err) {
                        err.code = 'KeyGenereateError';
                        return callback(err);
                    }

                    if (!result || !result.key) {
                        let err = new Error('Failed to generate private key');
                        err.code = 'KeyGenereateError';
                        return callback(err);
                    }

                    privateKeyPem = result.key;
                    return done();
                });
            }

            // Fallback to Forge
            forge.rsa.generateKeyPair({ bits: 2048, workers: -1 }, (err, keypair) => {
                if (err) {
                    err.code = 'KeyGenereateError';
                    return callback(err);
                }
                privateKeyPem = forge.pki.privateKeyToPem(keypair.privateKey);
                publicKeyPem = forge.pki.publicKeyToPem(keypair.publicKey);
                return done();
            });
        };

        let getPublicKey = done => {
            if (publicKeyPem) {
                return done();
            }

            // extract public key from private key

            if (this.useOpenSSL) {
                return pem.getPublicKey(privateKeyPem, (err, result) => {
                    if (err) {
                        err.code = 'KeyGenereateError';
                        return callback(err);
                    }

                    if (!result || !result.publicKey) {
                        let err = new Error('Failed to generate public key');
                        err.code = 'KeyGenereateError';
                        return callback(err);
                    }

                    publicKeyPem = result.publicKey;
                    return done();
                });
            }

            // Fallback to Forge
            let privateKey = forge.pki.privateKeyFromPem(privateKeyPem);
            let publicKey = forge.pki.setRsaPublicKey(privateKey.n, privateKey.e);
            publicKeyPem = forge.pki.publicKeyToPem(publicKey);

            if (!publicKeyPem) {
                let err = new Error('Failed to generate public key');
                err.code = 'KeyGenereateError';
                return callback(err);
            }

            done();
        };

        getPrivateKey(() => {
            getPublicKey(() => {
                let fp;
                try {
                    fp = fingerprint(privateKeyPem, 'sha256', true);

                    let ciphered = crypto.publicEncrypt(publicKeyPem, Buffer.from('secretvalue'));
                    let deciphered = crypto.privateDecrypt(privateKeyPem, ciphered);
                    if (deciphered.toString() !== 'secretvalue') {
                        throw new Error('Was not able to use key for encryption');
                    }
                } catch (E) {
                    let err = new Error('Invalid or incompatible private key. ' + E.message);
                    err.code = 'InputValidationError';
                    return callback(err);
                }

                if (this.secret) {
                    try {
                        let cipher = crypto.createCipher(this.cipher || 'aes192', this.secret);
                        privateKeyPem = '$' + cipher.update(privateKeyPem, 'utf8', 'hex');
                        privateKeyPem += cipher.final('hex');
                    } catch (E) {
                        let err = new Error('Failed to encrypt private key. ' + E.message);
                        err.code = 'InternalConfigError';
                        return callback(err);
                    }
                }

                let dkimData = {
                    domain,
                    selector,
                    privateKey: privateKeyPem,
                    publicKey: publicKeyPem,
                    fingerprint: fp,
                    created: new Date(),
                    latest: true
                };

                if (description) {
                    dkimData.description = description;
                }

                this.database.collection('dkim').findOneAndReplace(
                    {
                        domain
                    },
                    dkimData,
                    {
                        upsert: true,
                        returnOriginal: false
                    },
                    (err, r) => {
                        if (err) {
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        if (!r.value) {
                            let err = new Error('Failed to insert DKIM key');
                            err.code = 'InternalDatabaseError';
                            return callback(err);
                        }

                        return callback(null, {
                            id: r.value._id,
                            domain: dkimData.domain,
                            selector: dkimData.selector,
                            description: dkimData.description,
                            fingerprint: dkimData.fingerprint,
                            publicKey: dkimData.publicKey,
                            dnsTxt: {
                                name: dkimData.selector + '._domainkey.' + dkimData.domain,
                                value: 'v=DKIM1;t=s;p=' + dkimData.publicKey.replace(/^-.*-$/gm, '').replace(/\s/g, '')
                            }
                        });
                    }
                );
            });
        });
    }

    get(options, includePrivateKey, callback) {
        let query = {};
        options = options || {};

        if (options.domain) {
            query.domain = tools.normalizeDomain(options.domain);
        } else if (options._id && tools.isId(options._id)) {
            query._id = new ObjectID(options._id);
        } else {
            let err = new Error('Invalid or unknown DKIM key');
            err.code = 'KeyNotFound';
            return setImmediate(() => callback(err));
        }

        this.database.collection('dkim').findOne(query, (err, dkimData) => {
            if (err) {
                err.code = 'InternalDatabaseError';
                return callback(err);
            }
            if (!dkimData) {
                let err = new Error('Invalid or unknown DKIM key');
                err.code = 'KeyNotFound';
                return callback(err);
            }

            let privateKey;
            if (includePrivateKey) {
                privateKey = dkimData.privateKey;
                if (privateKey.charAt(0) === '$') {
                    if (this.secret) {
                        try {
                            let decipher = crypto.createDecipher(this.cipher || 'aes192', this.secret);
                            privateKey = decipher.update(privateKey.substr(1), 'hex', 'utf-8');
                            privateKey += decipher.final('utf8');
                        } catch (E) {
                            let err = new Error('Failed to decrypt private key. ' + E.message);
                            err.code = 'InternalConfigError';
                            return callback(err);
                        }
                    } else {
                        let err = new Error('Can not use decrypted key');
                        err.code = 'InternalConfigError';
                        return callback(err);
                    }
                }
            }

            callback(null, {
                id: dkimData._id,
                domain: dkimData.domain,
                selector: dkimData.selector,
                description: dkimData.description,
                fingerprint: dkimData.fingerprint,
                publicKey: dkimData.publicKey,
                privateKey,
                dnsTxt: {
                    name: dkimData.selector + '._domainkey.' + dkimData.domain,
                    value: 'v=DKIM1;t=s;p=' + dkimData.publicKey.replace(/^-.*-$/gm, '').replace(/\s/g, '')
                },
                created: dkimData.created
            });
        });
    }

    del(options, callback) {
        let query = {};

        if (options.domain) {
            query.domain = tools.normalizeDomain(options.domain);
        } else if (options._id && tools.isId(options._id)) {
            query._id = new ObjectID(options._id);
        } else {
            let err = new Error('Invalid or unknown DKIM key');
            err.code = 'KeyNotFound';
            return setImmediate(() => callback(err));
        }

        // delete address from email address registry
        this.database.collection('dkim').deleteOne(query, (err, r) => {
            if (err) {
                err.code = 'InternalDatabaseError';
                return callback(err);
            }

            if (!r.deletedCount) {
                let err = new Error('Invalid or unknown DKIM key');
                err.code = 'KeyNotFound';
                return callback(err);
            }

            return callback(null, !!r.deletedCount);
        });
    }
}

module.exports = DkimHandler;
