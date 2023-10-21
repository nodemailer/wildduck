local key = KEYS[1];

local identifier = ARGV[1];
local ttl = tonumber(ARGV[2]) or 0;

if redis.call("EXISTS", key) == 1 then

    local existing = redis.call("GET", key);
    if existing == identifier then
        redis.call("EXPIRE", key, ttl);
        return 1;
    else
        return nil;
    end

else
    local result = redis.call("SET", key, identifier);
    if result then
        redis.call("EXPIRE", key, ttl);
        return 2;
    else
        return nil;
    end
end