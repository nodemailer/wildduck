'use strict';

module.exports = {
    // home many modifications to cache before writing
    BULK_BATCH_SIZE: 150,

    // how often to clear expired messages
    GC_INTERVAL: 10 * 60 * 1000,

    // artificail delay between deleting next expired message in ms
    GC_DELAY_DELETE: 100,

    MAX_STORAGE: 1 * (1024 * 1024 * 1024),
    MAX_RECIPIENTS: 2000,
    MAX_FORWARDS: 2000,

    JUNK_RETENTION: 30 * 24 * 3600 * 1000
};
