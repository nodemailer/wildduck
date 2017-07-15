'use strict';

module.exports = {
    // home many modifications to cache before writing
    BULK_BATCH_SIZE: 150,

    // how often to clear expired messages
    GC_INTERVAL: 10 * 60 * 1000,

    // artificail delay between deleting next expired message in ms
    GC_DELAY_DELETE: 100
};
