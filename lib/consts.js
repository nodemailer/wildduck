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

    BCRYPT_ROUNDS: 11, // bcrypt.js benchmark async in a VPS: 261.192ms, do not want to take it too long

    // how many authentication failures per user to allow before blocking until the end of the auth window
    USER_AUTH_FAILURES: 12,
    // authentication window in seconds, starts counting from first invalid authentication
    USER_AUTH_WINDOW: 120,

    // how many authentication failures per ip to allow before blocking until the end of the auth window
    IP_AUTH_FAILURES: 10,
    // authentication window in seconds, starts counting from first invalid authentication
    IP_AUTH_WINDOW: 300,

    // how many TOTP failures per user to allow before blocking until the end of the auth window
    TOTP_FAILURES: 6,
    // TOTP authentication window in seconds, starts counting from first invalid authentication
    TOTP_WINDOW: 180,

    SCOPES: ['imap', 'pop3', 'smtp'],

    // Refuse to process messages larger than 64 MB. Allowing larger messages might cause jumbo chunks in MongoDB
    MAX_ALLOWE_MESSAGE_SIZE: 64 * 1024 * 1024,

    // how long to keep deleted messages around before purgeing
    ARCHIVE_TIME: 25 * 24 * 3600 * 1000
};
