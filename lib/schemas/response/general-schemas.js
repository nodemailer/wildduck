'use strict';

const { booleanSchema } = require('../../schemas');

const successRes = booleanSchema.required().description('Indicates successful response');

module.exports = {
    successRes
};
