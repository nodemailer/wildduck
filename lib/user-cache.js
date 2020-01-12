'use strict';

class UserCache {
    constructor(options) {
        this.users = options.users;
        this.redis = options.redis;
    }

    flush(user, callback) {
        this.redis.del('cached:' + user, () => callback());
    }

    get(user, key, defaultValue, callback) {
        this.redis.hget('cached:' + user, key, (err, value) => {
            if (err) {
                return callback(err);
            }

            if (value) {
                return callback(null, Number(value));
            }

            this.users.collection('users').findOne(
                {
                    _id: user
                },
                {
                    projection: {
                        [key]: true
                    }
                },
                (err, userData) => {
                    if (err) {
                        return callback(err);
                    }

                    if (!userData) {
                        return callback(null, defaultValue);
                    }

                    value = userData[key] || defaultValue;
                    this.redis
                        .multi()
                        .hset('cached:' + user, key, value)
                        .expire('cached:' + user, 3600)
                        .exec(err => {
                            if (err) {
                                return callback(err);
                            }
                            return callback(null, value);
                        });
                }
            );
        });
    }
}

module.exports = UserCache;
