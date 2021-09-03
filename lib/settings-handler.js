'use strict';

const { encrypt, decrypt } = require('./encrypt');

class SettingsHandler {
    constructor(opts) {
        opts = opts || {};
        this.db = opts.db;
    }

    async set(key, value, options) {
        options = options || {};

        let encrypted = false;
        if (options.secret && options.encrypt) {
            value = await encrypt(JSON.stringify(value), options.secret);
        } else {
            value = JSON.stringify(value);
        }

        let $set = {
            key,
            value
        };

        if (encrypted) {
            $set.encrypted = true;
        } else {
            $set.encrypted = false;
        }

        let $setOnInsert = {
            created: new Date()
        };

        if (options && 'enumerable' in options) {
            $set.enumerable = !!options.enumerable;
        } else {
            // default for new keys
            $setOnInsert.enumerable = true;
        }

        let r = await this.db.collection('settings').findOneAndUpdate(
            {
                key
            },
            {
                $set,
                $setOnInsert
            },
            { upsert: true, returnDocument: 'after' }
        );

        return r.value && r.value.value;
    }

    async get(key, options) {
        options = options || {};
        let row = await this.db.collection('settings').findOne({
            key
        });

        if (row && row.encrypted && typeof row.value === 'string') {
            if (!options.secret) {
                throw new Error('Secret not provided for encrypted value');
            }
            let value = await decrypt(row.value, options.secret);
            return JSON.parse(value);
        } else if (row && typeof row.value === 'string') {
            return JSON.parse(row.value);
        }

        return row ? row.value : options.default;
    }

    async del(key) {
        return await this.db.collection('settings').deleteOne({
            key
        });
    }

    async list(prefix, options) {
        options = options || {};
        let query = { enumerable: true };
        if (prefix) {
            query.key = {
                $regex: '^' + prefix.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&'),
                $options: 'i'
            };
        }
        let list = await this.db.collection('settings').find(query).project({ key: true, value: true }).toArray();
        let results = {};
        for (let row of list) {
            try {
                if (row && row.encrypted && typeof row.value === 'string') {
                    if (!options.secret) {
                        throw new Error('Secret not provided for encrypted value');
                    }
                    let value = await decrypt(row.value, options.secret);
                    row.value = JSON.parse(value);
                } else if (row && typeof row.value === 'string') {
                    row.value = JSON.parse(row.value);
                }

                results[row.key] = row.value;
            } catch (err) {
                // ignore?
            }
        }
        return results;
    }
}

module.exports.SettingsHandler = SettingsHandler;
