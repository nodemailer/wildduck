'use strict';

const config = require('wild-config');
const pathlib = require('path');

const WD_PATH = pathlib.join(__dirname, '..');
const CONFIG_PATH = pathlib.join(__dirname, '..');

module.exports = next => {
    console.log(config);
    setImmediate(next);
};
