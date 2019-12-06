'use strict';

const log = require('npmlog');
const db = require('../db');
const consts = require('../consts');

let run = async taskData => {
	// TODO here schedule the mail (which comes from taskData) to unsnooze at a particular time
	// Set bullmq to call an event at a particular time (which you'll get from mailObject.snooze)
	// That event will move the email back to the inbox (you can use moveMessage from message-handler.js)
};

module.exports = (taskData, options, callback) => {
    run(taskData)
        .then(response => callback(null, response))
        .catch(callback);
};
