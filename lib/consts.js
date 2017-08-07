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

    JUNK_RETENTION: 30 * 24 * 3600 * 1000,

    MAILBOX_COUNTER_TTL: 24 * 3600,

    SCHEMA_VERSION: '1.0',
    // how much plaintext to store. this is indexed with a fulltext index
    MAX_PLAINTEXT_CONTENT: 2 * 1024,

    // how much HTML content to store. not indexed
    MAX_HTML_CONTENT: 300 * 1024,

    MAX_AUTOREPLY_INTERVAL: 4 * 24 * 3600 * 1000,

    MAX_AUTOREPLIES: 2000,

    BCRYPT_ROUNDS: 12,

    // how many authentication failures per user to allow before blocking until the end of the auth window
    AUTH_FAILURES: 5,
    // authentication window in seconds, starts counting from first invalid authentication
    AUTH_WINDOW: 60,

    // how many TOTP failures per user to allow before blocking until the end of the auth window
    TOTP_FAILURES: 6,
    // TOTP authentication window in seconds, starts counting from first invalid authentication
    TOTP_WINDOW: 180
};
