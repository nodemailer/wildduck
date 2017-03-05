'use strict';

module.exports = {
    state: 'Selected',

    handler(command, callback) {
        this.session.selected = this.selected = false;
        this.state = 'Authenticated';

        this.updateNotificationListener(() => {
            callback(null, {
                response: 'OK'
            });
        });
    }
};
