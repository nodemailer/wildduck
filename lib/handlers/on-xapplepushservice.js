'use strict';

//
// Thanks to Forward Email
// <https://forwardemail.net>
// <https://github.com/nodemailer/wildduck/issues/711>
// tag XAPPLEPUSHSERVICE aps-version 2 aps-account-id 0715A26B-CA09-4730-A419-793000CA982E aps-device-token 2918390218931890821908309283098109381029309829018310983092892829 aps-subtopic com.apple.mobilemail mailboxes (INBOX Notes)
//
module.exports = server => (accountID, deviceToken, subTopic, mailboxes, session, callback) => {
    server.logger.debug(
        {
            tnx: 'xapplepushservice',
            cid: session.id
        },
        '[%s] XAPPLEPUSHSERVICE accountID "%s" deviceToken "%s" subTopic "%s" mailboxes "%s"',
        session.id,
        accountID,
        deviceToken,
        subTopic,
        mailboxes
    );
    return callback(new Error('Not implemented, see <https://github.com/nodemailer/wildduck/issues/711>'));
};
