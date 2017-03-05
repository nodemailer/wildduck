'use strict';

module.exports = {
    handler(command, callback) {

        let capabilities = [];

        if (!this.secure) {
            capabilities.push('STARTTLS');
            if (!this._server.options.ignoreSTARTTLS) {
                capabilities.push('LOGINDISABLED');
            }
            capabilities.push('ENABLE');
            capabilities.push('CONDSTORE');
        }

        if (this.state === 'Not Authenticated') {
            capabilities.push('AUTH=PLAIN');
            capabilities.push('ID');
            capabilities.push('SASL-IR');
        } else {
            capabilities.push('CHILDREN');
            capabilities.push('ID');
            capabilities.push('IDLE');
            capabilities.push('NAMESPACE');
            capabilities.push('SPECIAL-USE');
            capabilities.push('UIDPLUS');
            capabilities.push('UNSELECT');
        }

        capabilities.sort((a, b) => a.localeCompare(b));

        this.send('* CAPABILITY ' + ['IMAP4rev1'].concat(capabilities).join(' '));

        callback(null, {
            response: 'OK'
        });
    }
};
