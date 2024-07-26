'use strict';

//
// Thanks to Forward Email
// <https://forwardemail.net>
// <https://github.com/nodemailer/wildduck/issues/711>
// tag XAPPLEPUSHSERVICE aps-version 2 aps-account-id 0715A26B-CA09-4730-A419-793000CA982E aps-device-token 2918390218931890821908309283098109381029309829018310983092892829 aps-subtopic com.apple.mobilemail mailboxes (INBOX Notes)
//

module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [
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

    handler(command, callback) {
        const version = Buffer.from((command.attributes[0] && command.attributes[0].value) || '', 'binary').toString();
        if (version !== "2")
            return callback(null, {
                response: 'NO',
                code: 'CLIENTBUG'
            });

        const accountID = Buffer.from((command.attributes[1] && command.attributes[1].value) || '', 'binary').toString();
        const deviceToken = Buffer.from((command.attributes[2] && command.attributes[2].value) || '', 'binary').toString();
        const subTopic = Buffer.from((command.attributes[3] && command.attributes[3].value) || '', 'binary').toString();

        if (subTopic !== "com.apple.mobilemail")
            return callback(null, {
                response: 'NO',
                code: 'CLIENTBUG'
            });

        // NOTE: mailboxes param is not used at this time (it's a list anyways too)
        const mailboxes = Buffer.from((command.attributes[4] && command.attributes[4].value) || '', 'binary').toString();

        if (typeof this._server.onXAPPLEPUSHSERVICE !== 'function') {
            return callback(null, {
                response: 'NO',
                message: command.command + ' not implemented'
            });
        }

        let logdata = {
            short_message: '[XAPPLEPUSHSERVICE]',
            _mail_action: 'xapplepushservice',
            _accountId: accountID,
            _deviceToken: deviceToken,
            _subTopic: subTopic,
            _mailboxes: mailboxes,
            _user: this.session.user.id.toString(),
            _sess: this.id
        };

        this._server.onXAPPLEPUSHSERVICE(accountID, deviceToken, subTopic, mailboxes, this.session, (err) => {
            if (err) {
                logdata._error = err.message;
                logdata._code = err.code;
                logdata._response = err.response;
                this._server.loggelf(logdata);

                return callback(null, {
                    response: 'NO',
                    code: 'TEMPFAIL'
                });
            }

            callback(null, {
                response: 'OK',
                message: 'Success'
            });
        });
    }
};
