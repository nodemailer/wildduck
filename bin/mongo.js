'use strict';
// reveal mongodb settings based on current environment
const config = require('config');
process.stdout.write(config.mongo);
