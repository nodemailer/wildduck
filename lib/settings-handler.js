'use strict';

const { encrypt, decrypt } = require('./encrypt');
const consts = require('./consts');
const Joi = require('joi');
const tools = require('./tools');

const SETTING_KEYS = [
    {
        key: 'const:archive:time',
        name: 'Archive time',
        description: 'Time in ms after deleted messages will be purged',
        type: 'duration',
        constKey: 'ARCHIVE_TIME',
        schema: Joi.number()
    },

    {
        key: 'const:max:storage',
        name: 'Disk quota',
        description: 'Maximum allowed storage size in bytes',
        type: 'size',
        constKey: 'MAX_STORAGE',
        schema: Joi.number()
    },

    {
        key: 'const:max:recipients',
        name: 'Max recipients',
        description: 'Daily maximum recipients count',
        type: 'number',
        constKey: 'MAX_RECIPIENTS',
        schema: Joi.number()
    },

    {
        key: 'const:max:forwards',
        name: 'Max forwards',
        description: 'Daily maximum forward count',
        type: 'number',
        constKey: 'MAX_FORWARDS',
        schema: Joi.number()
    },

    {
        key: 'const:authlog:time',
        name: 'Auth log time',
        description: 'Time in ms after authentication log entries will be purged',
        type: 'duration',
        constKey: 'AUTHLOG_TIME',
        schema: Joi.number()
    },

    {
        key: 'const:autoreply:interval',
        name: 'Autoreply interval',
        description: 'Delay between autoreplies for the same sender',
        type: 'duration',
        constKey: 'MAX_AUTOREPLY_INTERVAL',
        schema: Joi.number()
    }
];

class SettingsHandler {
    constructor(opts) {
        opts = opts || {};
        this.db = opts.db;

        this.keys = SETTING_KEYS;
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

    async getMulti(keys, options) {
        options = options || {};

        let rows = await this.db
            .collection('settings')
            .find({
                key: { $in: keys }
            })
            .toArray();

        let result = {};
        for (let key of keys) {
            let row = rows.find(row => row.key === key);
            if (row && row.encrypted && typeof row.value === 'string') {
                if (!options.secret) {
                    throw new Error('Secret not provided for encrypted value');
                }
                let value = await decrypt(row.value, options.secret);
                result[key] = JSON.parse(value);
            } else if (row && typeof row.value === 'string') {
                result[key] = JSON.parse(row.value);
            } else {
                let keyInfo = this.keys.find(k => k.key === key) || {};
                let defaultValue = 'default' in options ? options.default : keyInfo.constKey ? consts[keyInfo.constKey] : undefined;

                result[key] = row ? row.value : defaultValue;
            }
        }

        return result;
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

        let keyInfo = this.keys.find(k => k.key === key) || {};
        let defaultValue = 'default' in options ? options.default : keyInfo.constKey ? consts[keyInfo.constKey] : undefined;

        return row ? row.value : defaultValue;
    }

    async del(key) {
        return await this.db.collection('settings').deleteOne({
            key
        });
    }

    async list(filter, options) {
        options = options || {};
        let query = { enumerable: true };
        if (filter) {
            query.key = {
                $regex: tools.escapeRegexStr(filter),
                $options: 'i'
            };
        }

        let list = await this.db.collection('settings').find(query).project({ key: true, value: true }).toArray();
        let results = [];
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

                let keyInfo = this.keys.find(k => k.key === row.key) || {};

                results.push({
                    key: row.key,
                    value: row.value,
                    name: keyInfo.name,
                    description: keyInfo.description,
                    default: keyInfo.constKey ? consts[keyInfo.constKey] : undefined,
                    type: keyInfo.type,
                    custom: true
                });
            } catch (err) {
                // ignore?
            }
        }

        for (let row of this.keys) {
            if (results.some(k => k.key === row.key)) {
                continue;
            }

            results.push({
                key: row.key,
                value: row.constKey ? consts[row.constKey] : undefined,
                name: row.name,
                description: row.description,
                default: row.constKey ? consts[row.constKey] : undefined,
                type: row.type,
                custom: false
            });
        }

        return results.sort((a, b) => a.key.localeCompare(b.key));
    }
}

module.exports.SettingsHandler = SettingsHandler;
