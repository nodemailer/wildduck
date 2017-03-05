'use strict';

module.exports = {
    state: 'Selected',

    handler(command, callback) {

        // Check if EXPUNGE method is set
        if (typeof this._server.onExpunge !== 'function') {
            return callback(null, {
                response: 'NO',
                message: 'EXPUNGE not implemented'
            });
        }

        // Do nothing if in read only mode
        if (this.selected.readOnly) {
            return callback(null, {
                response: 'OK'
            });
        }

        this._server.onExpunge(this.selected.mailbox, {
            isUid: false
        }, this.session, (err, success) => {
            if (err) {
                return callback(err);
            }

            callback(null, {
                response: success === true ? 'OK' : 'NO',
                code: typeof success === 'string' ? success.toUpperCase() : false
            });
        });
    }
};
