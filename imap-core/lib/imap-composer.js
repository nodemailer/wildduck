'use strict';

const imapHandler = require('./handler/imap-handler');
const Transform = require('stream').Transform;

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
            this.connection.logger.debug(
                {
                    tnx: 'pipeout',
                    cid: this.connection.id
                },
                '[%s] S: %s<pipe message stream to socket>',
                this.connection.id,
                obj.description || ''
            );
            obj.pipe(this.connection[!this.connection.compression ? '_socket' : '_deflate'], {
                end: false
            });
            obj.once('error', err => this.emit('error', err));
            obj.once('end', () => {
                this.push('\r\n');
                done();
            });
            return;
        }

        let compiled = imapHandler.compiler(obj);

        this.connection.logger.debug(
            {
                tnx: 'send',
                cid: this.connection.id
            },
            '[%s] S:',
            this.connection.id,
            compiled
        );

        this.push(Buffer.from(compiled + '\r\n', 'binary'));
        done();
    }

    _flush(done) {
        done();
    }
}

module.exports.IMAPComposer = IMAPComposer;
