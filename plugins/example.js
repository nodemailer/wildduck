'use strict';

module.exports.title = 'Example Plugin';

module.exports.init = (app, done) => {
    // do your initialization stuff here

    // init hook is called immediately after server is started
    app.addHook('init', async () => {
        app.logger.info('Example plugin initialized. Value1=%s', JSON.stringify(app.config));
    });

    setImmediate(done);
};
