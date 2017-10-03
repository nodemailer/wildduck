local key = KEYS[1];
local increment = tonumber(ARGV[1]) or 0;
local limit = tonumber(ARGV[2]) or 0;
local windowSize = tonumber(ARGV[3]) or 0;
local current = tonumber(redis.call("GET", key)) or 0;

if current >= limit then
    local ttl = tonumber(redis.call("TTL", key)) or 0;
    return {0, current, ttl};
end;

local updated;
local ttl;

if increment > 0 then
    -- increment
    updated = tonumber(redis.call("INCRBY", key, increment));
    if current == 0 then
        redis.call("EXPIRE", key, windowSize);
    end;
    ttl = tonumber(redis.call("TTL", key)) or 0;
else
    -- return current
    updated = current;
    ttl = tonumber(redis.call("TTL", key)) or windowSize;
end;

return {1, updated, ttl};
