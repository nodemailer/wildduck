'use strict';

module.exports = {
    state: ['Authenticated', 'Selected'],
    handler(command, callback) {
        callback(null, {
            response: 'OK'
        });
    }
};
