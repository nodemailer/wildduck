'use strict';

module.exports = {
    handler(command, callback) {
        let capabilities = [];

        if (!this.secure) {
            if (!this._server.options.disableSTARTTLS) {
                capabilities.push('STARTTLS');
                if (!this._server.options.ignoreSTARTTLS) {
                    capabilities.push('LOGINDISABLED');
                }
            }
        }

        if (this.state === 'Not Authenticated') {
            capabilities.push('AUTH=PLAIN');
            // might cause issues with some clients
            // capabilities.push('AUTH=PLAIN-CLIENTTOKEN');
            capabilities.push('ID');
            capabilities.push('SASL-IR');
            capabilities.push('ENABLE');
            capabilities.push('XLIST');
        } else {
            capabilities.push('CHILDREN');
            capabilities.push('ID');
            capabilities.push('IDLE');
            capabilities.push('NAMESPACE');
            capabilities.push('SPECIAL-USE');
            capabilities.push('UIDPLUS');
            capabilities.push('UNSELECT');
            capabilities.push('ENABLE');
            capabilities.push('CONDSTORE');
            capabilities.push('UTF8=ACCEPT');
            capabilities.push('QUOTA');
            capabilities.push('XLIST');

            capabilities.push('MOVE');
            capabilities.push('COMPRESS=DEFLATE');

            if (this._server.options.maxMessage) {
                capabilities.push('APPENDLIMIT=' + this._server.options.maxMessage);
            }
        }

        capabilities.sort((a, b) => a.localeCompare(b));

        this.send('* CAPABILITY ' + ['IMAP4rev1'].concat(capabilities).join(' '));

        callback(null, {
            response: 'OK'
        });
    }
};
