'use strict';

const packageInfo = require('../../../package');
const imapHandler = require('../handler/imap-handler');
const imapTools = require('../imap-tools');

const allowedKeys = ['name', 'version', 'os', 'os-version', 'vendor', 'support-url', 'address', 'date', 'command', 'arguments', 'environment'];

module.exports = {
    schema: [
        {
            name: 'id',
            type: ['null', 'array']
        }
    ],
    handler(command, callback) {
        let clientId = {};
        let serverId = {};
        let serverIdList = [];
        let key = false;
        let maxKeyLen = 0;

        if (this._server.options.id && typeof this._server.options.id === 'object') {
            Object.keys(this._server.options.id).forEach(key => {
                serverId[key] = this._server.options.id[key];
            });
        } else {
            serverId.name = packageInfo.name;
            serverId.version = packageInfo.version;
            serverId.vendor = 'Kreata';
        }

        // Log ID information proviced by the client
        if (Array.isArray(command.attributes[0])) {
            command.attributes[0].forEach(val => {
                if (key === false) {
                    key = (val.value || '').toString().toLowerCase().trim();
                } else {
                    if (allowedKeys.indexOf(key) >= 0) {
                        clientId[key] = (val.value || '').toString();
                        maxKeyLen = Math.max(maxKeyLen, key.length);
                    }
                    key = false;
                }
            });

            this._server.logger.info(
                {
                    tnx: 'id',
                    cid: this.id
                },
                '[%s] Client identification data received',
                this.id
            );

            Object.keys(clientId)
                .sort((a, b) => allowedKeys.indexOf(a) - allowedKeys.indexOf(b))
                .forEach(key => {
                    this._server.logger.info(
                        {
                            tnx: 'id',
                            cid: this.id
                        },
                        '[%s] %s%s: %s',
                        this.id,
                        key,
                        new Array(maxKeyLen - key.length + 1).join(' '),
                        clientId[key]
                    );
                });

            this.session.clientId = clientId;
            imapTools.logClientId(this);
        }

        // Create response ID serverIdList
        if (Object.keys(serverId).length) {
            Object.keys(serverId).forEach(key => {
                serverIdList.push({
                    type: 'string',
                    value: (key || '').toString()
                });
                serverIdList.push({
                    type: 'string',
                    value: (serverId[key] || '').toString()
                });
            });
        }

        this.send(
            imapHandler.compiler({
                tag: '*',
                command: 'ID',
                attributes: serverIdList.length
                    ? [serverIdList]
                    : {
                          type: 'atom',
                          value: 'NIL'
                      }
            })
        );

        callback(null, {
            response: 'OK'
        });
    }
};
