'use strict';

const Scripty = require('node-redis-scripty');

const ttlCounterScript = `
local key = KEYS[1];
local increment = tonumber(ARGV[1]) or 0;
local limit = tonumber(ARGV[2]) or 0;
local current = tonumber(redis.call("GET", key)) or 0;

if current >= limit then
    local ttl = tonumber(redis.call("TTL", key)) or 0;
    return {0, current, ttl};
end;

local updated = tonumber(redis.call("INCRBY", key, increment));
if current == 0 then
    redis.call("EXPIRE", key, 86400);
end;

local ttl = tonumber(redis.call("TTL", key)) or 0;

return {1, updated, ttl};
`;

const cachedCounterScript = `
local key = KEYS[1];
local increment = tonumber(ARGV[1]) or 0;
local ttl = tonumber(ARGV[2]) or 0;

if redis.call("EXISTS", key) == 1 then
    redis.call("INCRBY", key, increment);
    -- extend the life of this counter by ttl seconds
    redis.call("EXPIRE", key, ttl);
    return redis.call("GET", key);
else
    return nil;
end
`;

module.exports = redis => {
    let scripty = new Scripty(redis);

    return {
        ttlcounter(key, count, max, callback) {
            scripty.loadScript('ttlcounter', ttlCounterScript, (err, script) => {
                if (err) {
                    return callback(err);
                }
                script.run(1, key, count, max, (err, res) => {
                    if (err) {
                        return callback(err);
                    }
                    return callback(null, {
                        success: !!((res && res[0]) || 0),
                        value: (res && res[1]) || 0,
                        ttl: (res && res[2]) || 0
                    });
                });
            });
        },

        cachedcounter(key, count, ttl, callback) {
            scripty.loadScript('cachedCounter', cachedCounterScript, (err, script) => {
                if (err) {
                    return callback(err);
                }
                script.run(1, key, count, ttl, callback);
            });
        }
    };
};
