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
const libqp = require('libqp');
const libbase64 = require('libbase64');
const iconv = require('iconv-lite');

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
                size += Buffer.from((first ? '' : '\r\n') + (data || ''), 'binary').length;
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
     * @param  {Boolean} skipExternal If true, do not include the external nodes
     * @return {Stream} Message stream
     */
    rebuild(mimeTree, textOnly, skipExternal) {
        let res = new PassThrough();
        let first = true;
        let root = true;
        let remainder = false;

        // make sure that mixed body + mime gets rebuilt correctly
        let append = (data, force) => {
            if (Array.isArray(data)) {
                data = data.join('\r\n');
            }
            if (remainder || data || force) {
                if (!first) {
                    res.write('\r\n');
                } else {
                    first = false;
                }

                if (remainder && remainder.length) {
                    res.write(remainder);
                }

                if (data) {
                    res.write(Buffer.from(data, 'binary'));
                }
            }
            remainder = false;
        };

        let walk = (node, next) => {

            if (!textOnly || !root) {
                append(formatHeaders(node.header).join('\r\n') + '\r\n');
            }

            root = false;
            if (Buffer.isBuffer(node.body)) {
                // node Buffer
                remainder = node.body;
            } else if (node.body && node.body.buffer) {
                // mongodb Binary
                remainder = node.body.buffer;
            } else if (typeof node.body === 'string') {
                // binary string
                remainder = Buffer.from(node.body, 'binary');
            } else {
                // whatever
                remainder = node.body;
            }

            let finalize = () => {
                if (node.boundary) {
                    append('--' + node.boundary + '--\r\n');
                }

                append();
                next();
            };

            if (node.boundary) {
                append('--' + node.boundary);
            } else if (node.attachmentId && !skipExternal) {
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
     * Stores attachments to GridStore, decode text/plain and text/html parts
     */
    processContent(messageId, mimeTree, sizeLimit, callback) {
        let response = {
            attachments: [],
            text: '',
            html: ''
        };

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

            let flowed = false;
            let delSp = false;

            let parsedContentType = node.parsedHeader['content-type'];
            let parsedDisposition = node.parsedHeader['content-disposition'];
            let transferEncoding = (node.parsedHeader['content-transfer-encoding'] || '7bit').toLowerCase().trim();

            let contentType = (parsedContentType && parsedContentType.value || (node.rootNode ? 'text/plain' : 'application/octet-stream')).toLowerCase().trim();

            if (parsedContentType && parsedContentType.params.format && parsedContentType.params.format.toLowerCase().trim() === 'flowed') {
                flowed = true;
                if (parsedContentType.params.delsp && parsedContentType.params.delsp.toLowerCase().trim() === 'yes') {
                    delSp = true;
                }
            }

            let disposition = (parsedDisposition && parsedDisposition.value || '').toLowerCase().trim() || false;

            let curSizeLimit = sizeLimit;

            // If the current node is HTML or Plaintext then allow larger content included in the mime tree
            // Also decode text value
            if (['text/plain', 'text/html'].includes(contentType) && (!disposition || disposition === 'inline')) {
                curSizeLimit = Math.max(sizeLimit, 200 * 1024);
                if (node.body && node.body.length) {
                    let charset = parsedContentType.params.charset || 'windows-1257';
                    let textContent = node.body;

                    if (transferEncoding === 'base64') {
                        textContent = libbase64.decode(textContent.toString());
                    } else if (transferEncoding === 'base64') {
                        textContent = libqp.decode(textContent.toString());
                    }

                    if (!['ascii', 'usascii', 'utf8'].includes(charset.replace(/[^a-z0-9]+/g, '').trim().toLowerCase())) {
                        try {
                            textContent = iconv.decode(textContent, charset);
                        } catch (E) {
                            // do not decode charset
                        }
                    }

                    if (flowed) {
                        textContent = libmime.decodeFlowed(textContent.toString(), delSp);
                    } else {
                        textContent = textContent.toString();
                    }

                    let subType = contentType.split('/').pop();
                    if (!response[subType]) {
                        response[subType] = textContent;
                    } else {
                        response[subType] += '\n' + textContent;
                    }
                }
            }

            if (node.body && node.size > curSizeLimit) {
                let attachmentId = new ObjectID();

                let fileName = (node.parsedHeader['content-disposition'] && node.parsedHeader['content-disposition'].params && node.parsedHeader['content-disposition'].params.filename) || (node.parsedHeader['content-type'] && node.parsedHeader['content-type'].params && node.parsedHeader['content-type'].params.name) || false;

                if (fileName) {
                    try {
                        fileName = libmime.decodeWords(fileName).trim();
                    } catch (E) {
                        // failed to parse filename, keep as is (most probably an unknown charset is used)
                    }
                }

                let returned = false;
                let store = this.gridstore.createWriteStream(attachmentId, {
                    fsync: true,
                    content_type: contentType,
                    metadata: {
                        // if we copy the same message to other mailboxes then instead
                        // of copying attachments we add a pointer to the new message here
                        messages: [messageId],
                        // decoded filename to display in a web client or API
                        fileName,
                        // content-type for the attachment
                        contentType,
                        // is it really an attachment? maybe it's a very long text part?
                        disposition,
                        // how to decode contents if a webclient or API asks for the attachment
                        transferEncoding
                    }
                });

                if (!['text/plain', 'text/html'].includes(contentType) || disposition === 'attachment') {
                    response.attachments.push({
                        id: attachmentId,
                        fileName,
                        contentType,
                        disposition,
                        transferEncoding
                    });
                }

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

                store.end(node.body);
            } else {
                continueProcessing();
            }
        };
        walk(mimeTree, err => {
            if (err) {
                return callback(err);
            }
            callback(null, response);
        });
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
            return setImmediate(() => callback(null, Buffer.from((data || '').toString(), 'binary')));
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
     * @param  {Boolean} skipExternal If true, do not include the external nodes
     * @return {String} node contents
     */
    getContents(mimeTree, selector, skipExternal) {
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
                    return this.rebuild(node, false, skipExternal);
                }
                // BODY[1.2.3]
                return this.rebuild(node, true, skipExternal);

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
                    return this.rebuild(node, true, skipExternal);
                } else if (node.message) {
                    // BODY[1.2.3.TEXT] embedded message/rfc822 body without headers
                    return this.rebuild(node.message, true, skipExternal);
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
