'use strict';

module.exports = {
    SCHEMA_VERSION: '1.0',

    // how many modifications to cache before writing
    BULK_BATCH_SIZE: 150,

    // how often to clear expired messages
    GC_INTERVAL: 15 * 60 * 1000,

    // artificail delay between deleting next expired message in ms
    // set to 0 to disable
    GC_DELAY_DELETE: 0,

    // default
    MAX_STORAGE: 1 * (1024 * 1024 * 1024),
    MAX_RECIPIENTS: 2000,
    MAX_FORWARDS: 2000,

    JUNK_RETENTION: 30 * 24 * 3600 * 1000,

    MAILBOX_COUNTER_TTL: 24 * 3600,

    // how much plaintext to store in a full text indexed field
    MAX_PLAINTEXT_INDEXED: 1 * 1024,

    // how much plaintext to store before truncating
    MAX_PLAINTEXT_CONTENT: 100 * 1024,

    // how much HTML content to store before truncating. not indexed
    MAX_HTML_CONTENT: 300 * 1024,

    MAX_AUTOREPLY_INTERVAL: 4 * 3600 * 1000,

    MAX_AUTOREPLIES: 2000,

    BCRYPT_ROUNDS: 12,

    // how many authentication failures per user to allow before blocking until the end of the auth window
    AUTH_FAILURES: 6,
    // authentication window in seconds, starts counting from first invalid authentication
    AUTH_WINDOW: 60,

    // how many TOTP failures per user to allow before blocking until the end of the auth window
    TOTP_FAILURES: 6,
    // TOTP authentication window in seconds, starts counting from first invalid authentication
    TOTP_WINDOW: 180,

    SCOPES: ['imap', 'pop3', 'smtp'],

    // Refuse to process messages larger than 64 MB. Allowing larger messages might cause jumbo chunks in MongoDB
    MAX_ALLOWE_MESSAGE_SIZE: 64 * 1024 * 1024,

    // how long to keep deleted messages around before purgeing
    ARCHIVE_TIME: 2 * 7 * 24 * 3600 * 1000
};
