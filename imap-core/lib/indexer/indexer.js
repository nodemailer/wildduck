/* eslint no-console: 0 */

'use strict';

const stream = require('stream');
const PassThrough = stream.PassThrough;

const BodyStructure = require('./body-structure');
const createEnvelope = require('./create-envelope');
const parseMimeTree = require('./parse-mime-tree');
const LengthLimiter = require('../length-limiter');
const ObjectID = require('mongodb').ObjectID;
const GridFs = require('grid-fs');
const libmime = require('libmime');

class Indexer {

    constructor(options) {
        this.options = options || {};
        this.fetchOptions = this.options.fetchOptions || {};

        this.database = this.options.database;
        if (this.database) {
            this.gridstore = new GridFs(this.database, 'attachments');
        }

        // create logger
        this.logger = this.options.logger || {
            info: () => false,
            debug: () => false,
            error: () => false
        };
    }

    /**
     * Returns expected size for a node
     *
     * @param  {Object} mimeTree Parsed mimeTree object (or sub node)
     * @param  {Boolean} textOnly If true, do not include the message header in the response
     * @return {String} Expected message size
     */
    getSize(mimeTree, textOnly) {
        let size = 0;
        let first = true;
        let root = true;

        // make sure that mixed body + mime gets rebuilt correctly
        let append = (data, force) => {
            if (Array.isArray(data)) {
                data = data.join('\r\n');
            }
            if (data || force) {
                size += new Buffer((first ? '' : '\r\n') + (data || ''), 'binary').length;
                first = false;
            }
        };

        let walk = (node, next) => {

            if (!textOnly || !root) {
                append(formatHeaders(node.header).join('\r\n') + '\r\n');
            }

            let finalize = () => {
                if (node.boundary) {
                    append('--' + node.boundary + '--\r\n');
                }

                append();
                next();
            };

            root = false;

            if (node.body || node.attachmentId) {
                append(false, true); // force newline
                size += node.size;
            }

            if (node.boundary) {
                append('--' + node.boundary);
            }

            if (Array.isArray(node.childNodes)) {
                let pos = 0;
                let processChildNodes = () => {
                    if (pos >= node.childNodes.length) {
                        return finalize();
                    }
                    let childNode = node.childNodes[pos++];
                    walk(childNode, () => {
                        if (pos < node.childNodes.length) {
                            append('--' + node.boundary);
                        }
                        return processChildNodes();
                    });
                };
                processChildNodes();
            } else {
                finalize();
            }
        };

        walk(mimeTree, () => false);

        return size;
    }

    /**
     * Builds a parsed mime tree into a rfc822 message
     *
     * @param  {Object} mimeTree Parsed mimeTree object
     * @param  {Boolean} textOnly If true, do not include the message header in the response
     * @return {Stream} Message stream
     */
    rebuild(mimeTree, textOnly) {
        let res = new PassThrough();
        let first = true;
        let root = true;
        let remainder = '';

        // make sure that mixed body + mime gets rebuilt correctly
        let append = (data, force) => {
            if (Array.isArray(data)) {
                data = data.join('\r\n');
            }
            if (remainder || data || force) {
                res.write(new Buffer((first ? '' : '\r\n') + (remainder || '') + (data || ''), 'binary'));
                first = false;
            }
            remainder = '';
        };

        let walk = (node, next) => {

            if (!textOnly || !root) {
                append(formatHeaders(node.header).join('\r\n') + '\r\n');
            }

            root = false;

            remainder = node.body || '';

            let finalize = () => {
                if (node.boundary) {
                    append('--' + node.boundary + '--\r\n');
                }

                append();
                next();
            };

            if (node.boundary) {
                append('--' + node.boundary);
            } else if (node.attachmentId) {
                append(false, true); // force newline between header and contents

                let limiter = new LengthLimiter(node.size);
                let attachmentStream = this.gridstore.createReadStream(node.attachmentId);

                attachmentStream.once('error', err => {
                    res.emit('error', err);
                });

                limiter.once('error', err => {
                    res.emit('error', err);
                });

                limiter.once('end', () => finalize());

                attachmentStream.pipe(limiter).pipe(res, {
                    end: false
                });
                return;
            }

            let pos = 0;
            let processChildNodes = () => {
                if (pos >= node.childNodes.length) {
                    return finalize();
                }
                let childNode = node.childNodes[pos++];
                walk(childNode, () => {
                    if (pos < node.childNodes.length) {
                        append('--' + node.boundary);
                    }
                    setImmediate(processChildNodes);
                });
            };

            if (Array.isArray(node.childNodes)) {
                processChildNodes();
            } else {
                finalize();
            }
        };

        setImmediate(walk.bind(null, mimeTree, () => {
            res.end();
        }));

        return {
            type: 'stream',
            value: res,
            expectedLength: this.getSize(mimeTree, textOnly)
        };
    }

    /**
     * Parses structured MIME tree from a rfc822 message source
     *
     * @param  {String|Buffer} rfc822 E-mail message as 'binary'-string or Buffer
     * @return {Object} Parsed mime tree
     */
    parseMimeTree(rfc822) {
        return parseMimeTree(rfc822);
    }

    /**
     * Parses structured MIME tree from a rfc822 message source
     *
     * @param  {String|Buffer} rfc822 E-mail message as 'binary'-string or Buffer
     * @return {Object} Parsed mime tree
     */
    storeAttachments(messageId, mimeTree, sizeLimit, callback) {
        let walk = (node, next) => {

            let continueProcessing = () => {
                if (Array.isArray(node.childNodes)) {
                    let pos = 0;
                    let processChildNode = () => {
                        if (pos >= node.childNodes.length) {
                            return next();
                        }
                        let childNode = node.childNodes[pos++];
                        walk(childNode, processChildNode);
                    };
                    setImmediate(processChildNode);
                } else {
                    setImmediate(next);
                }
            };

            if (node.body && node.size > sizeLimit) {
                let attachmentId = new ObjectID();
                let contentType = node.parsedHeader['content-type'] && node.parsedHeader['content-type'].value || 'application/octet-stream';
                let fileName = (node.parsedHeader['content-disposition'] && node.parsedHeader['content-disposition'].params && node.parsedHeader['content-disposition'].params.filename) || (node.parsedHeader['content-type'] && node.parsedHeader['content-type'].params && node.parsedHeader['content-type'].params.name) || false;

                if (fileName) {
                    try {
                        fileName = libmime.decodeWords(fileName);
                    } catch (E) {
                        // failed to parse filename, keep as is (most probably an unknown charset is used)
                    }
                }

                let returned = false;
                let store = this.gridstore.createWriteStream(attachmentId, {
                    fsync: true,
                    content_type: contentType,
                    metadata: {
                        messages: [messageId],
                        fileName,
                        contentType,
                        created: new Date()
                    }
                });

                store.once('error', err => {
                    if (returned) {
                        return;
                    }
                    returned = true;
                    callback(err);
                });

                store.on('close', () => {
                    if (returned) {
                        return;
                    }
                    returned = true;

                    node.body = false;
                    node.attachmentId = attachmentId;

                    return continueProcessing();
                });

                store.end(Buffer.from(node.body, 'binary'));
            } else {
                continueProcessing();
            }
        };
        walk(mimeTree, callback);
    }

    /**
     * Generates IMAP compatible BODY object from message tree
     *
     * @param  {Object} mimeTree Parsed mimeTree object
     * @return {Array} BODY object as a structured Array
     */
    getBody(mimeTree) {

        // BODY – BODYSTRUCTURE without extension data
        let body = new BodyStructure(mimeTree, {
            upperCaseKeys: true,
            body: true
        });

        return body.create();
    }

    /**
     * Generates IMAP compatible BODYSTRUCUTRE object from message tree
     *
     * @param  {Object} mimeTree Parsed mimeTree object
     * @return {Array} BODYSTRUCTURE object as a structured Array
     */
    getBodyStructure(mimeTree) {

        // full BODYSTRUCTURE
        let bodystructure = new BodyStructure(mimeTree, {
            upperCaseKeys: true,
            skipContentLocation: false
        });

        return bodystructure.create();
    }

    /**
     * Generates IMAP compatible ENVELOPE object from message headers
     *
     * @param  {Object} mimeTree Parsed mimeTree object
     * @return {Array} ENVELOPE object as a structured Array
     */
    getEnvelope(mimeTree) {
        return createEnvelope(mimeTree.parsedHeader || {});
    }

    /**
     * Resolves numeric path to a node in the parsed MIME tree
     *
     * @param  {Object} mimeTree Parsed mimeTree object
     * @param  {String} path     Dot-separated numeric path
     * @return {Object}          Mime node
     */
    resolveContentNode(mimeTree, path) {
        if (!mimeTree.childNodes && path === '1') {
            path = '';
        }

        let pathNumbers = (path || '').toString().split('.');
        let contentNode = mimeTree;
        let pathNumber;

        while ((pathNumber = pathNumbers.shift())) {
            pathNumber = Number(pathNumber) - 1;
            if (contentNode.message) {
                // redirect to message/rfc822
                contentNode = contentNode.message;
            }

            if (contentNode.childNodes && contentNode.childNodes[pathNumber]) {
                contentNode = contentNode.childNodes[pathNumber];
            } else {
                return false;
            }
        }

        return contentNode;
    }

    bodyQuery(mimeTree, selector, callback) {
        let data = this.getContents(mimeTree, selector);

        if (data && data.type === 'stream') {
            let sent = false;
            let buffers = [];
            let buflen = 0;

            data.value.on('readable', () => {
                let buf;
                while ((buf = data.value.read())) {
                    buffers.push(buf);
                    buflen += buf.length;
                }
            });

            data.value.on('error', err => {
                if (sent) {
                    return;
                }
                sent = true;
                return callback(err);
            });

            data.value.on('end', () => {
                if (sent) {
                    return;
                }
                sent = true;
                return callback(null, Buffer.concat(buffers, buflen));
            });

        } else {
            return setImmediate(() => callback(null, new Buffer((data || '').toString(), 'binary')));
        }
    }

    /**
     * Get node contents
     *
     * *selector* is an object with the following properties:
     *  * *path* – numeric path 1.2.3
     *  * *type* - one of content|header|header.fields|header.fields.not|text|mime
     *  * *headers* - an array of headers to include/exclude
     *
     * @param  {Object} mimeTree Parsed mimeTree object
     * @param  {Object} selector What data to return
     * @return {String} node contents
     */
    getContents(mimeTree, selector) {
        let node = mimeTree;

        if (typeof selector === 'string') {
            selector = {
                type: selector
            };
        }
        selector = selector || {
            type: ''
        };

        if (selector.path) {
            node = this.resolveContentNode(mimeTree, selector.path);
        }

        if (!node) {
            return '';
        }

        switch (selector.type) {
            case '':
            case 'content':
                if (!selector.path) {
                    // BODY[]
                    return this.rebuild(node);
                }
                // BODY[1.2.3]
                return this.rebuild(node, true);

            case 'header':
                if (!selector.path) {
                    // BODY[HEADER] mail header
                    return formatHeaders(node.header).join('\r\n') + '\r\n\r\n';
                } else if (node.message) {
                    // BODY[1.2.3.HEADER] embedded message/rfc822 header
                    return (node.message.header || []).join('\r\n') + '\r\n\r\n';
                }
                return '';

            case 'header.fields':
                // BODY[HEADER.FIELDS.NOT (Key1 Key2 KeyN)] only selected header keys
                if (!selector.headers || !selector.headers.length) {
                    return '\r\n\r\n';
                }
                return formatHeaders(node.header).filter(line => {
                    let key = line.split(':').shift().toLowerCase().trim();
                    return selector.headers.indexOf(key) >= 0;
                }).join('\r\n') + '\r\n\r\n';

            case 'header.fields.not':
                // BODY[HEADER.FIELDS.NOT (Key1 Key2 KeyN)] all but selected header keys
                if (!selector.headers || !selector.headers.length) {
                    return formatHeaders(node.header).join('\r\n') + '\r\n\r\n';
                }
                return formatHeaders(node.header).filter(line => {
                    let key = line.split(':').shift().toLowerCase().trim();
                    return selector.headers.indexOf(key) < 0;
                }).join('\r\n') + '\r\n\r\n';

            case 'mime':
                // BODY[1.2.3.MIME] mime node header
                return formatHeaders(node.header).join('\r\n') + '\r\n\r\n';

            case 'text':
                if (!selector.path) {
                    // BODY[TEXT] mail body without headers
                    return this.rebuild(node, true);
                } else if (node.message) {
                    // BODY[1.2.3.TEXT] embedded message/rfc822 body without headers
                    return this.rebuild(node.message, true);
                }

                return '';
            default:
                return '';
        }
    }
}

function formatHeaders(headers) {
    headers = headers || [];
    if (!Array.isArray(headers)) {
        headers = [].concat(headers || []);
    }
    return headers;
}

module.exports = Indexer;
