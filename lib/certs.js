'use strict';

const config = require('wild-config');
const fs = require('fs');

const certs = new Map();

// load certificate files
[false, 'imap', 'lmtp', 'pop3', 'api', 'api.mobileconfig'].forEach(type => {
    let tlsconf = config.tls;

    if (type) {
        let path = (type + '.tls').split('.');
        tlsconf = config;
        for (let i = 0; i < path.length; i++) {
            let key = path[i];
            if (!tlsconf[key]) {
                tlsconf = false;
                break;
            }
            tlsconf = tlsconf[key];
        }
        if (!tlsconf || !tlsconf.key) {
            tlsconf = config.tls;
        }
    }

    if (!tlsconf) {
        return;
    }

    let key, cert, ca;

    if (tlsconf.key) {
        key = fs.readFileSync(tlsconf.key, 'ascii');
    }

    if (!key) {
        return;
    }

    if (tlsconf.cert) {
        cert = fs.readFileSync(tlsconf.cert, 'ascii');
    }

    if (tlsconf.ca) {
        ca = [].concat(tlsconf.ca || []).map(ca => fs.readFileSync(ca, 'ascii'));
        if (!ca.length) {
            ca = false;
        }
    }

    certs.set(type || 'default', {
        key,
        cert,
        ca
    });
});

if (!certs.has('default')) {
    certs.set('default', {
        key: fs.readFileSync(__dirname + '/../certs/example.key', 'ascii'),
        cert: fs.readFileSync(__dirname + '/../certs/example.cert', 'ascii'),
        ca: false
    });
}

module.exports.get = type => (certs.has(type) ? certs.get(type) : certs.get('default')) || false;
