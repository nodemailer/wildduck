local key = KEYS[1];

local entry = ARGV[1];

local increment = tonumber(ARGV[2]) or 0;
local limit = tonumber(ARGV[3]) or 0;
local clientVersion = tonumber(ARGV[4]) or 0;
local existingVersion = tonumber(redis.call("HGET", key, "_version")) or 0;

-- Limited counter is not exact. Every client should use timestampt or incrementing value
-- as client ID. Whenever a new client is introduced, existing counter cache is wiped.
-- This should ensure that normally counters are limited but on a server failure when a client
-- restarts then old values to not collide with new ones.
if clientVersion > existingVersion then
    redis.call("DEL", key);
    redis.call("HSET", key, "_version", clientVersion);
end;

local current = tonumber(redis.call("HGET", key, entry)) or 0;

if increment == 0 then
    return {1, current};
end;

if increment < 0 then
    -- Remove entry

    if current < 1 then
        -- nothing to do here
        return {1, 0};
    end;

    current = tonumber(redis.call("HINCRBY", key, entry, increment)) or 0;
    return {1, current};
end;

-- Add entry

if current >= limit then
    -- over capacity
    return {0, current};
end;

current = tonumber(redis.call("HINCRBY", key, entry, increment)) or 0;
return {1, current};
