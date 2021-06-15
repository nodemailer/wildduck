'use strict';

const log = require('npmlog');
const config = require('wild-config');

let run = async (taskData, options) => {
    const { getCertificate } = options;

    let cert = await getCertificate(taskData.servername, config.acme);

    log.verbose('Tasks', 'task=acme id=%s servername=%s status=%s', taskData._id, taskData.servername, cert && cert.status);
    return true;
};

module.exports = (taskData, options, callback) => {
    run(taskData, options)
        .then(response => callback(null, response))
        .catch(callback);
};
