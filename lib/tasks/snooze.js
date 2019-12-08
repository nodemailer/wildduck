'use strict';

const db = require('../db');
const util = require('util');
const { Worker } = require('bullmq');

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

let snoozeWorker;

module.exports = (taskData, options, callback) => {
	// Tasks aren't really required here, since bullmq will take care of that for us
	// TODO rewrite the tasks API using some combination of bullmq + persistent storage
	messageHandler = options.messageHandler;

	snoozeWorker = new Worker('snoozeWorker', async job => {
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

	snoozeWorker.close();

	return callback(null, {});
};
