'use strict';

const ObjectID = require('mongodb').ObjectID;
const fingerprint = require('key-fingerprint').fingerprint;
const crypto = require('crypto');
const tls = require('tls');
const tools = require('./tools');
const { publish, CERT_CREATED, CERT_UPDATED, CERT_DELETED } = require('./events');

class CertHandler {
    constructor(options) {
        options = options || {};
        this.cipher = options.cipher;
        this.secret = options.secret;

        this.database = options.database;
        this.redis = options.redis;

        this.loggelf = options.loggelf || (() => false);
    }

    async set(options) {
        const servername = tools.normalizeDomain(options.servername);
        const description = options.description;

        let privateKey = options.privateKey;
        const cert = options.cert;

        let fp;
        try {
            fp = fingerprint(privateKey, 'sha256', true);
        } catch (E) {
            let err = new Error('Invalid or incompatible private key. ' + E.message);
            err.code = 'InputValidationError';
            throw err;
        }

        if (this.secret) {
            try {
                let cipher = crypto.createCipher(this.cipher || 'aes192', this.secret);
                privateKey = '$' + cipher.update(privateKey, 'utf8', 'hex');
                privateKey += cipher.final('hex');
            } catch (E) {
                let err = new Error('Failed to encrypt private key. ' + E.message);
                err.code = 'InternalConfigError';
                throw err;
            }
        }

        let certData = {
            privateKey,
            cert,
            fingerprint: fp,
            updated: new Date()
        };

        if (description) {
            certData.description = description;
        }

        try {
            // should fail on invalid input
            tls.createSecureContext({
                key: privateKey,
                cert
            });
        } catch (E) {
            let err = new Error('Invalid or incompatible key and certificate. ' + E.message);
            err.code = 'InputValidationError';
            throw err;
        }

        let r;
        try {
            r = await this.database.collection('certs').findOneAndUpdate(
                {
                    servername
                },
                { $set: certData, $inc: { v: 1 }, $setOnInsert: { servername, created: new Date() } },
                {
                    upsert: true,
                    returnOriginal: false
                }
            );
        } catch (err) {
            if (err) {
                err.code = 'InternalDatabaseError';
                throw err;
            }
        }

        if (!r.value) {
            let err = new Error('Failed to insert Cert key');
            err.code = 'InternalDatabaseError';
            throw err;
        }

        if (this.redis) {
            try {
                if (r.lastErrorObject.upserted) {
                    await publish(this.redis, {
                        ev: CERT_CREATED,
                        cert: r.value._id.toString(),
                        servername,
                        fingerprint: fp
                    });
                } else if (r.lastErrorObject.updatedExisting) {
                    await publish(this.redis, {
                        ev: CERT_UPDATED,
                        cert: r.value._id.toString(),
                        servername,
                        fingerprint: fp
                    });
                }
            } catch (err) {
                // ignore?
            }
        }

        return {
            id: r.value._id.toString(),
            servername: certData.servername,
            description: certData.description,
            fingerprint: certData.fingerprint
        };
    }

    async get(options, includePrivateKey) {
        let query = {};
        options = options || {};

        if (options.servername) {
            query.servername = tools.normalizeDomain(options.servername);
        } else if (options._id && tools.isId(options._id)) {
            query._id = new ObjectID(options._id);
        } else {
            let err = new Error('Invalid or unknown cert');
            err.code = 'CertNotFound';
            throw err;
        }

        let certData;
        try {
            certData = await this.database.collection('certs').findOne(query);
        } catch (err) {
            err.code = 'InternalDatabaseError';
            throw err;
        }
        if (!certData) {
            let err = new Error('Invalid or unknown cert');
            err.code = 'CertNotFound';
            throw err;
        }

        let privateKey;
        if (includePrivateKey) {
            privateKey = this.decodeKey(certData.privateKey);
        }

        return {
            id: certData._id.toString(),
            servername: certData.servername,
            description: certData.description,
            fingerprint: certData.fingerprint,
            privateKey,
            created: certData.created
        };
    }

    decodeKey(privateKey) {
        if (privateKey.charAt(0) === '$') {
            if (this.secret) {
                try {
                    let decipher = crypto.createDecipher(this.cipher || 'aes192', this.secret);
                    privateKey = decipher.update(privateKey.substr(1), 'hex', 'utf-8');
                    privateKey += decipher.final('utf8');
                } catch (E) {
                    let err = new Error('Failed to decrypt private key. ' + E.message);
                    err.code = 'InternalConfigError';
                    throw err;
                }
            } else {
                let err = new Error('Can not use decrypted key');
                err.code = 'InternalConfigError';
                throw err;
            }
        }
        return privateKey;
    }

    async del(options) {
        let query = {};

        if (options.servername) {
            query.servername = tools.normalizeDomain(options.servername);
        } else if (options._id && tools.isId(options._id)) {
            query._id = new ObjectID(options._id);
        } else {
            let err = new Error('Invalid or unknown cert');
            err.code = 'CertNotFound';
            throw err;
        }

        // delete cert key from database
        let r;
        try {
            r = await this.database.collection('certs').findOneAndDelete(query);
        } catch (err) {
            err.code = 'InternalDatabaseError';
            throw err;
        }

        if (!r.value) {
            let err = new Error('Invalid or unknown cert');
            err.code = 'CertNotFound';
            throw err;
        }

        try {
            await publish(this.redis, {
                ev: CERT_DELETED,
                cert: r.value._id,
                servername: r.value.servername,
                fingerprint: r.value.fingerprint
            });
        } catch (err) {
            // ignore?
        }

        return true;
    }
}

module.exports = CertHandler;
