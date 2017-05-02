'use strict';

const Scripty = require('node-redis-scripty');

const counterScript = `
local increment = tonumber(ARGV[1]) or 0;
local limit = tonumber(ARGV[2]) or 0;
local current = tonumber(redis.call("GET", KEYS[1])) or 0;

if current >= limit then
    local ttl = tonumber(redis.call("TTL", KEYS[1])) or 0;
    return {0, current, ttl};
end;

local updated = tonumber(redis.call("INCRBY", KEYS[1], increment));
if current == 0 then
    redis.call("EXPIRE", KEYS[1], 86400);
end;

local ttl = tonumber(redis.call("TTL", KEYS[1])) or 0;

return {1, updated, ttl};
`;

module.exports = redis => {
    let scripty = new Scripty(redis);

    return {
        ttlcounter(key, count, max, callback) {
            scripty.loadScript('counter', counterScript, (err, script) => {
                if (err) {
                    return callback(err);
                }
                script.run(1, key, count, max, (err, res) => {
                    if (err) {
                        return callback(err);
                    }
                    return callback(null, {
                        success: !!(res && res[0] || 0),
                        value: res && res[1] || 0,
                        ttl: res && res[2] || 0
                    });
                });
            });
        }
    };
};
