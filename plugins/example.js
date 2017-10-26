'use strict';

module.exports.title = 'Example Plugin';

module.exports.init = (app, done) => {
    // do your initialization stuff here

    // init hook is called immediatelly after server is started
    app.addHook('init', next => {
        app.logger.info('Example plugin initialized. Value1=%s', app.config.value1);
        next();
    });

    setImmediate(done);
};
