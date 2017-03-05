'use strict';

module.exports = {
    handler(command) {
        this.session.selected = this.selected = false;
        this.state = 'Logout';

        this.updateNotificationListener(() => {
            this.send('* BYE Logout requested');
            this.send(command.tag + ' OK All dreams are but another reality. Never forget...');
            this.close();
        });
    }
};
