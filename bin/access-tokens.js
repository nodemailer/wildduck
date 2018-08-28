#!/usr/bin/env node

'use strict';

// FUTURE FEATURE
// this executable should generate and dispose access tokens for the API

//const config = require('wild-config');
const db = require('../lib/db');
const errors = require('../lib/errors');
const log = require('npmlog');

// Initialize database connection
db.connect(err => {
    if (err) {
        log.error('Db', 'Failed to setup database connection');
        errors.notify(err);
        return setTimeout(() => process.exit(1), 3000);
    }

    log.info('Future feature');
    process.exit();
});
