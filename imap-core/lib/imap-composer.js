'use strict';

let imapHandler = require('./handler/imap-handler');
let Transform = require('stream').Transform;

class IMAPComposer extends Transform {

    constructor(options) {
        super();
        Transform.call(this, {
            writableObjectMode: true
        });
        this.connection = options.connection;
    }


    _transform(obj, encoding, done) {
        if (!obj) {
            return done();
        }

        if (typeof obj.pipe === 'function') {
            // pipe stream to socket and wait until it finishes before continuing
            this.connection._server.logger.debug('[%s] S: <pipe message stream to socket>', this.connection.id);
            obj.pipe(this.connection._socket, {
                end: false
            });
            obj.on('error', err => this.emit('error', err));
            obj.on('end', () => {
                this.push('\r\n');
                done();
            });
            return;
        }

        let compiled = imapHandler.compiler(obj);

        this.connection._server.logger.debug('[%s] S:', this.connection.id, compiled);
        this.push(new Buffer(compiled + '\r\n', 'binary'));
        done();
    }

    _flush(done) {
        done();
    }

}

module.exports.IMAPComposer = IMAPComposer;
