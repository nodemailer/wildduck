'use strict';

const stream = require('stream');
const PassThrough = stream.PassThrough;

const BodyStructure = require('./body-structure');
const createEnvelope = require('./create-envelope');
const parseMimeTree = require('./parse-mime-tree');
const ObjectID = require('mongodb').ObjectID;
const GridFs = require('grid-fs');
const libmime = require('libmime');
const libqp = require('libqp');
const libbase64 = require('libbase64');
const iconv = require('iconv-lite');
const marked = require('marked');
const htmlToText = require('html-to-text');
const crypto = require('crypto');

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
                size += Buffer.byteLength((first ? '' : '\r\n') + (data || ''), 'binary');
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

            if (node.size || node.attachmentId) {
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

        let aborted = false;

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

            if (aborted) {
                return next();
            }

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

                let attachmentStream = this.gridstore.createReadStream(node.attachmentId);

                attachmentStream.once('error', err => {
                    res.emit('error', err);
                });

                attachmentStream.once('end', () => finalize());

                attachmentStream.pipe(res, {
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
                    if (aborted) {
                        return next();
                    }

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

        // if called then stops resolving rest of the message
        res.abort = () => {
            aborted = true;
        };

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
     * Decode text/plain and text/html parts, separate node bodies from the tree
     */
    processContent(messageId, mimeTree) {
        let response = {
            nodes: [],
            attachments: [],
            text: '',
            html: []
        };

        let htmlContent = [];
        let textContent = [];
        let cidMap = new Map();

        let walk = (node, alternative, related) => {
            let flowed = false;
            let delSp = false;

            let parsedContentType = node.parsedHeader['content-type'];
            let parsedDisposition = node.parsedHeader['content-disposition'];
            let transferEncoding = (node.parsedHeader['content-transfer-encoding'] || '7bit').toLowerCase().trim();

            let contentType = (parsedContentType && parsedContentType.value || (node.rootNode ? 'text/plain' : 'application/octet-stream')).toLowerCase().trim();

            alternative = alternative || contentType === 'multipart/alternative';
            related = related || contentType === 'multipart/related';

            if (parsedContentType && parsedContentType.params.format && parsedContentType.params.format.toLowerCase().trim() === 'flowed') {
                flowed = true;
                if (parsedContentType.params.delsp && parsedContentType.params.delsp.toLowerCase().trim() === 'yes') {
                    delSp = true;
                }
            }

            let disposition = (parsedDisposition && parsedDisposition.value || '').toLowerCase().trim() || false;
            let isInlineText = false;
            let isMultipart = contentType.split('/')[0] === 'multipart';

            // If the current node is HTML or Plaintext then allow larger content included in the mime tree
            // Also decode text/html value
            if (['text/plain', 'text/html', 'text/rfc822-headers', 'message/delivery-status'].includes(contentType) && (!disposition || disposition === 'inline')) {
                isInlineText = true;
                if (node.body && node.body.length) {
                    let charset = parsedContentType.params.charset || 'windows-1257';
                    let content = node.body;

                    if (transferEncoding === 'base64') {
                        content = libbase64.decode(content.toString());
                    } else if (transferEncoding === 'quoted-printable') {
                        content = libqp.decode(content.toString());
                    }

                    if (!['ascii', 'usascii', 'utf8'].includes(charset.replace(/[^a-z0-9]+/g, '').trim().toLowerCase())) {
                        try {
                            content = iconv.decode(content, charset);
                        } catch (E) {
                            // do not decode charset
                        }
                    }

                    if (flowed) {
                        content = libmime.decodeFlowed(content.toString(), delSp);
                    } else {
                        content = content.toString();
                    }

                    if (contentType === 'text/html') {
                        htmlContent.push(content.trim());
                        if (!alternative) {
                            textContent.push(htmlToText.fromString(content).trim());
                        }
                    } else {
                        textContent.push(content.trim());
                        if (!alternative) {
                            htmlContent.push(marked(content, {
                                breaks: true,
                                sanitize: true,
                                gfm: true,
                                tables: true,
                                smartypants: true
                            }).trim());
                        }
                    }
                }
            }

            // remove attachments and very large text nodes from the mime tree
            if (!isMultipart && node.body && node.body.length && (!isInlineText || node.size > 300 * 1024)) {
                let attachmentId = new ObjectID();

                let fileName = (node.parsedHeader['content-disposition'] && node.parsedHeader['content-disposition'].params && node.parsedHeader['content-disposition'].params.filename) || (node.parsedHeader['content-type'] && node.parsedHeader['content-type'].params && node.parsedHeader['content-type'].params.name) || false;
                let contentId = (node.parsedHeader['content-id'] || '').toString().replace(/<|>/g, '').trim();

                if (fileName) {
                    try {
                        fileName = libmime.decodeWords(fileName).trim();
                    } catch (E) {
                        // failed to parse filename, keep as is (most probably an unknown charset is used)
                    }
                } else {
                    fileName = (crypto.randomBytes(4).toString('hex') + '.' + libmime.detectExtension(contentType));
                }

                cidMap.set(contentId, {
                    id: attachmentId,
                    fileName
                });

                // push to queue
                response.nodes.push({
                    attachmentId,
                    options: {
                        fsync: true,
                        content_type: contentType,
                        // metadata should include only minimally required information, this would allow
                        // to share attachments between different messages if the content is exactly the same
                        // even though metadata (filename, content-disposition etc) might not
                        metadata: {
                            // if we copy the same message to other mailboxes then instead
                            // of copying attachments we add a pointer to the new message here
                            messages: [messageId],
                            // how to decode contents if a webclient or API asks for the attachment
                            transferEncoding
                        }
                    },
                    body: node.body
                });

                // do not include text content, multipart elements and embedded messages in the attachment list
                if (!isInlineText && !(contentType === 'message/rfc822' && (!disposition || disposition === 'inline'))) {
                    // list in the attachments array
                    response.attachments.push({
                        id: attachmentId,
                        fileName,
                        contentType,
                        disposition,
                        transferEncoding,
                        related,
                        // approximite size in kilobytes
                        sizeKb: Math.ceil((transferEncoding === 'base64' ? this.expectedB64Size(node.size) : node.size) / 1024)
                    });
                }

                node.body = false;
                node.attachmentId = attachmentId;
            }

            // message/rfc822
            if (node.message) {
                node = node.message;
            }

            if (Array.isArray(node.childNodes)) {
                node.childNodes.forEach(childNode => {
                    walk(childNode, alternative, related);
                });
            }
        };

        walk(mimeTree, false, false);

        let updateCidLinks = str => str.replace(/\bcid:([^\s"']+)/g, (match, cid) => {
            if (cidMap.has(cid)) {
                let attachment = cidMap.get(cid);
                return 'attachment:' + messageId + '/' + attachment.id.toString();
            }
            return match;
        });

        response.html = htmlContent.filter(str => str.trim()).map(updateCidLinks);
        response.text = textContent.filter(str => str.trim()).map(updateCidLinks).join('\n').trim();

        return response;
    }

    /**
     * Stores attachments to GridStore
     */
    storeNodeBodies(messageId, nodes, callback) {
        let pos = 0;
        let storeNode = () => {
            if (pos >= nodes.length) {
                return callback(null, true);
            }
            let nodeData = nodes[pos++];

            let returned = false;
            let store = this.gridstore.createWriteStream(nodeData.attachmentId, nodeData.options);

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
                return storeNode();
            });

            store.end(nodeData.body);
        };

        storeNode();
    }

    expectedB64Size(b64size) {
        b64size = Number(b64size) || 0;
        if (!b64size || b64size <= 0) {
            return 0;
        }

        let newlines = Math.floor(b64size / 78);
        return Math.ceil((b64size - newlines * 2) / 4 * 3);
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
