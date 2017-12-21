'use strict';

module.exports = (options, callback) => {
    let mail = {
        parentId: options.parentId,
        reason: 'forward',

        from: options.sender,
        to: options.recipient,

        targets: options.targets,

        interface: 'forwarder'
    };

    let message = options.maildrop(mail, (err, ...args) => {
        if (err || !args[0]) {
            if (err) {
                err.code = err.code || 'ERRCOMPOSE';
            }
            return callback(err, ...args);
        }
        options.db.database.collection('messagelog').insertOne(
            {
                id: args[0].id,
                messageId: args[0].messageId,
                action: 'FORWARD',
                parentId: options.parentId,
                from: options.sender,
                to: options.recipient,
                targets: options.targets,
                created: new Date()
            },
            () => callback(err, args && args[0] && args[0].id)
        );
    });
    if (message) {
        if (options.stream) {
            options.stream.pipe(message);
            options.stream.once('error', err => {
                message.emit('error', err);
            });
            return;
        }

        setImmediate(() => {
            let pos = 0;
            let writeNextChunk = () => {
                if (pos >= options.chunks.length) {
                    return message.end();
                }
                let chunk = options.chunks[pos++];
                if (!message.write(chunk)) {
                    return message.once('drain', writeNextChunk);
                } else {
                    setImmediate(writeNextChunk);
                }
            };
            setImmediate(writeNextChunk);
        });
    }
};
