-- inserts JSON values to a sorted set where score value is an incrementing number resolved from a KEYS[1].modifyIndex

-- check if the mailbox even exists
if not redis.call('exists', KEYS[1]) then
    return {err='Selected mailbox does not exist'}
end;

local len = table.getn(ARGV);

-- do a single increment to get id values for all elements instead of incrementing it one by one
local score = redis.call('hincrby', KEYS[1], 'modifyIndex', len) - len;

for i = 1, #ARGV do
    -- we include modification index in the stored value to ensure that all values are always unique
    -- otherwise adding new element with the same data does not insert a new entry but overrides
    -- an existing one

    redis.call('zadd', KEYS[2], score + i, tostring(score + i) .. ':' .. ARGV[i]);
end;

-- return the largest modification index
return score + len;