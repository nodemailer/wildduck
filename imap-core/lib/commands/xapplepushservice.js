'use strict';

//
// Thanks to Forward Email
// <https://forwardemail.net>
// <https://github.com/nodemailer/wildduck/issues/711>
// tag XAPPLEPUSHSERVICE aps-version 2 aps-account-id 0715A26B-CA09-4730-A419-793000CA982E aps-device-token 2918390218931890821908309283098109381029309829018310983092892829 aps-subtopic com.apple.mobilemail mailboxes (INBOX Notes)
//

module.exports = {
    state: ['Authenticated', 'Selected'],

	/*
    Schema: [
        {
            name: 'aps-version',
            type: 'number' // always 2
        },
        {
            name: 'aps-account-id',
            type: 'string'
        },
        {
            name: 'aps-device-token',
            type: 'string'
        },
        {
            name: 'aps-subtopic',
            type: 'string' // always "com.apple.mobilemail"
        },
        // NOTE: this is irrelevant as it won't be used until we figure out how to notify for other than INBOX
        //       <https://github.com/nodemailer/wildduck/issues/711#issuecomment-2251643672>
        {
            name: 'mailboxes',
            type: 'string' // e.g. (INBOX Notes)
        }
    ],
    */

	// it's actually something like this in production
	// [
	//   { type: 'ATOM', value: 'aps-version' },
	//   { type: 'ATOM', value: '2' },
	//   { type: 'ATOM', value: 'aps-account-id' },
	//   { type: 'ATOM', value: 'xxxxxxx' },
	//   { type: 'ATOM', value: 'aps-device-token' },
	//   {
	//     type: 'ATOM',
	//     value: 'xxxxxx'
	//   },
	//   { type: 'ATOM', value: 'aps-subtopic' },
	//   { type: 'ATOM', value: 'com.apple.mobilemail' },
	//   { type: 'ATOM', value: 'mailboxes' },
	//   [
	//     { type: 'STRING', value: 'Sent Mail' },
	//     { type: 'STRING', value: 'INBOX' }
	//   ]
	// ]

	// disabled for now
	schema: false,

	handler(command, callback) {
		// Command = {
		//   tag: 'I5',
		//   command: 'XAPPLEPUSHSERVICE',
		//   attributes: [
		//     { type: 'ATOM', value: 'aps-version' }, // 0
		//     { type: 'ATOM', value: '2' }, // 1
		//     { type: 'ATOM', value: 'aps-account-id' }, // 2
		//     { type: 'ATOM', value: 'xxxxxx' }, // 3
		//     { type: 'ATOM', value: 'aps-device-token' }, // 4
		//     {  // 5
		//       type: 'ATOM',
		//       value: 'xxxxxx'
		//     },
		//     { type: 'ATOM', value: 'aps-subtopic' }, // 6
		//     { type: 'ATOM', value: 'com.apple.mobilemail' }, // 7
		//     { type: 'ATOM', value: 'mailboxes' }, // 8
		//     [ // 9
		//       { type: 'STRING', value: 'Sent Mail' },
		//       { type: 'STRING', value: 'INBOX' }
		//     ]
		//   ]
		// }

		const version = (command.attributes[1] && command.attributes[1].value) || '';
		if (version !== '2') {
			return callback(null, {
				response: 'NO',
				code: 'CLIENTBUG',
			});
		}

		const accountID = (command.attributes[3] && command.attributes[3].value) || '';
		const deviceToken = (command.attributes[5] && command.attributes[5].value) || '';
		const subTopic = (command.attributes[7] && command.attributes[7].value) || '';

		if (subTopic !== 'com.apple.mobilemail') {
			return callback(null, {
				response: 'NO',
				code: 'CLIENTBUG',
			});
		}

		// NOTE: mailboxes param is not used at this time (it's a list anyways too)
		const mailboxes = command.attributes[9] && Array.isArray(command.attributes[9]) && command.attributes[9].length > 0 ? command.attributes[9].map(object => object.value) : [];

		if (typeof this._server.onXAPPLEPUSHSERVICE !== 'function') {
			return callback(null, {
				response: 'NO',
				message: command.command + ' not implemented',
			});
		}

		const logdata = {
			short_message: '[XAPPLEPUSHSERVICE]',
			_mail_action: 'xapplepushservice',
			_accountId: accountID,
			_deviceToken: deviceToken,
			_subTopic: subTopic,
			_mailboxes: mailboxes,
			_user: this.session.user.id.toString(),
			_sess: this.id,
		};

		this._server.onXAPPLEPUSHSERVICE(accountID, deviceToken, subTopic, mailboxes, this.session, error => {
			if (error) {
				logdata._error = error.message;
				logdata._code = error.code;
				logdata._response = error.response;
				this._server.loggelf(logdata);

				return callback(null, {
					response: 'NO',
					code: 'TEMPFAIL',
				});
			}

      // <https://opensource.apple.com/source/dovecot/dovecot-293/dovecot/src/imap/cmd-x-apple-push-service.c.auto.html>
      // <https://github.com/st3fan/dovecot-xaps-plugin/blob/3d1c71e0c78cc35ca6ead21f49a8e0e35e948a7c/xaps-imap-plugin.c#L158-L166>
      this.send(`* XAPPLEPUSHSERVICE aps-version "${version}" aps-topic "${subTopic}"`);
			callback(null, {
				response: 'OK',
        message: 'XAPPLEPUSHSERVICE Registration successful.'
			});
		});
	},
};
