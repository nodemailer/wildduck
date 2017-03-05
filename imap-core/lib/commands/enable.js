'use strict';

module.exports = {
    state: ['Authenticated'],
    schema: false,

    handler(command, callback) {
        let enabled = [];

        command.attributes.map(attr => {
            // only CONDSTORE is supported for now
            if ((attr && attr.value || '').toString().toUpperCase() === 'CONDSTORE') {
                this.condstoreEnabled = true;
                enabled.push('CONDSTORE');
            }
        });

        this.send('* ENABLED' + (enabled.length ? ' ' : '') + enabled.join(' '));

        callback(null, {
            response: 'OK',
            message: 'Conditional Store enabled'
        });
    }
};
