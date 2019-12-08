'use strict';

const log = require('npmlog');
const db = require('../db');
const consts = require('../consts');
const util = require('util');
const { Worker } = require('bullmq');

const snoozeWorker = new Worker('snoozeWorker', async job => {
	const user = job.data.user;
	const mailbox = job.data.snoozedMailbox;
	const destination = job.data.originalMailbox;
	const messageQuery = job.data.messageId;

	await moveMessage({
		user,
		source: { user, mailbox },
		destination: { user, mailbox: destination },
		messageQuery
	});
}, {
	connection: {
		host: db.redisConfig.host,
		port: db.redisConfig.port
	}
});

let messageHandler;

const moveMessage = util.promisify((...args) => {
	let callback = args.pop();
	messageHandler.move(...args, (err, result, info) => {
		if (err) {
			return callback(err);
		}
		return callback(null, { result, info });
	});
});

let run = async taskData => {
	// Tasks aren't really required here, since bullmq will take care of that for us
	// TODO rewrite the tasks API using some combination of bullmq + persistent storage
};

module.exports = (taskData, options, callback) => {
	messageHandler = options.messageHandler;
    run(taskData)
        .then(response => callback(null, response))
        .catch(callback);
};
