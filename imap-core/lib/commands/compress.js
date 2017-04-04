'use strict';

const zlib = require('zlib');

// tag COMPRESS DEFLATE
module.exports = {
    state: ['Authenticated', 'Selected'],

    schema: [{
        name: 'mechanism',
        type: 'string'
    }],

    handler(command, callback) {

        let mechanism = (command.attributes[0] && command.attributes[0].value || '').toString().toUpperCase().trim();

        if (!mechanism) {
            return callback(null, {
                response: 'BAD'
            });
        }

        if (mechanism !== 'DEFLATE') {
            return callback(null, {
                response: 'BAD',
                code: 'CANNOT',
                message: 'Unsupported compression mechanism'
            });
        }

        setImmediate(() => {
            this.compression = true;

            this._deflate = zlib.createDeflateRaw();
            this._inflate = zlib.createInflateRaw();

            this._deflate.once('error', err => {
                this._socket.emit('error', err);
            });

            this._deflate.pipe(this._socket);

            this.writeStream.unpipe(this._socket);
            this.writeStream.pipe(this._deflate);

            this._socket.unpipe(this._parser);
            this._socket.pipe(this._inflate).pipe(this._parser);
        });

        callback(null, {
            response: 'OK',
            message: 'DEFLATE active'
        });
    }
};
