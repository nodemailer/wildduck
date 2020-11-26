'use strict';

const os = require('os');
const uuid = require('uuid');

function processDataUrl(element, useBase64) {
    let parts = (element.path || element.href).match(/^data:((?:[^;]*;)*(?:[^,]*)),(.*)$/i);
    if (!parts) {
        return element;
    }

    if (useBase64) {
        element.content = /\bbase64$/i.test(parts[1]) ? parts[2] : Buffer.from(decodeURIComponent(parts[2])).toString('base64');
        element.encoding = 'base64';
    } else {
        element.content = /\bbase64$/i.test(parts[1]) ? Buffer.from(parts[2], 'base64') : Buffer.from(decodeURIComponent(parts[2]));
    }

    if ('path' in element) {
        delete element.path;
    }

    if ('href' in element) {
        delete element.href;
    }

    parts[1].split(';').forEach(item => {
        if (/^\w+\/[^/]+$/i.test(item)) {
            element.contentType = element.contentType || item.toLowerCase();
        }
    });

    return element;
}

/**
 * Extracts attachments from html field
 * @param {Object} data Parsed data object from client
 */
function preprocessAttachments(data) {
    let hostname = data.from && data.from.address && typeof data.from.address === 'string' ? data.from.address.split('@').pop() : os.hostname();

    if (data.html && typeof data.html === 'string' && data.html.length < 12 * 1024 * 1024) {
        let attachments = [];
        let cids = new Map();

        data.html = data.html.replace(/(<img\b[^>]* src\s*=[\s"']*)(data:[^"'>\s]+)/gi, (match, prefix, dataUri) => {
            if (cids.has(dataUri)) {
                return prefix + 'cid:' + cids.get(dataUri);
            }
            let cid = uuid.v4() + '-attachments@' + hostname;
            attachments.push(
                processDataUrl(
                    {
                        path: dataUri,
                        cid
                    },
                    true
                )
            );
            cids.set(dataUri, cid);
            return prefix + 'cid:' + cid;
        });

        if (attachments.length) {
            data.attachments = [].concat(data.attachments || []).concat(attachments);
        }
    }
}

module.exports = {
    processDataUrl,
    preprocessAttachments
};
