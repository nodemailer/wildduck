'use strict';

const config = require('wild-config');
const fs = require('fs');

const certs = new Map();

// load certificate files
[false, 'imap', 'lmtp', 'pop3'].forEach(type => {
    let tlsconf = type ? config[type] && config[type].tls : config.tls;

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

module.exports.get = type => (certs.has(type) ? certs.get(type) : certs.get('default')) || false;
